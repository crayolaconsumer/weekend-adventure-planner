import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { buildDiscoverOverpassQuery, GOOD_CATEGORY_TYPES } from '../../../shared/overpassQuery.js'
import { snapQueryBbox } from '../../../api/lib/bboxSnap.js'
import { townOverpassQuery, groupPlaces } from '../../../api/lib/towns.js'
import { pickPlaceElement } from '../../../shared/osmPick.mjs'
import { cellRanges, poiCell, CELL_PAD_DEG } from '../../../shared/poiCell.mjs'
const PAD = CELL_PAD_DEG
const POI_DEADLINE = 1000

vi.mock('../../../api/lib/kvCache.js', () => ({
  cacheGet: async () => null,
  cacheSet: async () => true,
  hashKey: v => v,
  isCacheEnabled: () => false,
  getClient: () => null
}))

// A pois row as cap phase 1 reads it from ix_rank: bounds and features, derived from el
// exactly as the build does (so plain { osm_type, osm_id, el } test rows work too)
function candidateOf(r) {
  const el = JSON.parse(r.el)
  const b = el.bounds || { minlat: el.lat, minlon: el.lon, maxlat: el.lat, maxlon: el.lon }
  // a table row carries its stored features (possibly wrong); a bare { el } row gets the build's
  const f = 'q' in r ? { q: r.q, cat: r.cat, flags: r.flags } : poiFeatures(el)
  return { osm_type: r.osm_type, osm_id: r.osm_id, min_lat: b.minlat, max_lat: b.maxlat, min_lon: b.minlon, max_lon: b.maxlon, ...f }
}

// Fake pool: poi_builds answers from `build`, everything else from `answer`.
// getConnection hands out the same fake (the cap's transaction), counted.
let build
let answer
let tableOwner = null
const answerSql = async (opts, params) => {
  if (/^(SET SESSION|START TRANSACTION|ROLLBACK)/.test(opts.sql)) return [[]]
  // the live table's build (its COMMENT): the active build unless a test says otherwise
  if (opts.sql.includes('information_schema.tables')) return [[{ owner: tableOwner ?? build?.build_id }]]
  if (opts.sql.includes('poi_builds')) {
    if (build instanceof Error) throw build
    return [build ? [build] : []]
  }
  const rows = await answer(opts, params)
  if (opts.sql.includes('FORCE INDEX (ix_rank)')) return [rows.map(candidateOf)]
  if (opts.sql.includes('FORCE INDEX (uq_osm)')) {
    const want = new Set(params.slice(1).map(id => `${params[0]}/${id}`))
    return [rows.filter(r => want.has(`${r.osm_type}/${r.osm_id}`))]
  }
  // Single-group tests may leave out the UNION's group column
  return [rows.map(r => ({ g: 0, ...r }))]
}
const poolQuery = vi.fn(answerSql)
const conns = { opened: 0, released: 0, destroyed: 0 }
const connQuery = vi.fn((...args) => poolQuery(...args)) // statements sent on a transaction's connection
const getConnection = vi.fn(async () => {
  conns.opened++
  return { query: connQuery, release: () => { conns.released++ }, destroy: () => { conns.destroyed++ } }
})
// shadow runs on its own short-lived connection (shadowPois), never the pool's
const shadowQuery = vi.fn(answerSql)
const shadowConns = { opened: 0, ended: 0, destroyed: 0 }
const dedicatedConnection = vi.fn(async () => {
  shadowConns.opened++
  return { query: shadowQuery, end: async () => { shadowConns.ended++ }, destroy: () => { shadowConns.destroyed++ } }
})
// runQuery (db.js) routes a pool query as (sql, params, timeout); the mock
// adapts it to the pool.query(options, params) shape the rest of the test uses
const runQuery = vi.fn((sql, params, timeout) => poolQuery({ sql, timeout }, params))
vi.mock('../../../api/lib/db.js', () => ({ getPool: () => ({ query: poolQuery, getConnection }), dedicatedConnection, runQuery }))

const { poiFeatures, rankCap, FEATURES_VERSION } = await import('../../../shared/poiRank.mjs')
const { SNAP_GRID_DEGREES } = await import('../../../api/lib/bboxSnap.js')
const { SCHEMA_VERSION } = await import('../../../shared/poiCell.mjs')
const {
  parseQuery, buildSql, buildCandidateSql, buildElSql, buildProbeSql, isRankable, queryPois, getPois, isCovered, breakerState, capBreakerState, lruUsage,
  _resetPoiState, TABLE_BUILD_SQL, POI_SCHEMA_VERSION, SCAN_ROWS, MAX_BODY_BYTES, CAP, RANK_SCAN_ROWS, LRU_BUDGET_BYTES, LRU_ENTRY_MAX_BYTES, MAX_CAP_RADIUS_KM
} = await import('../../../api/lib/poiQuery.js')
const { lookupPlace } = await import('../../../api/lib/placeLookup.js')
const { parseOverpassResponse, fetchPlaceById } = await import('../../../src/utils/apiClient.js')

const cellsOf = (s, w, n, e) => cellRanges(s, w, n, e).flatMap(([lo, hi]) => Array.from({ length: hi - lo + 1 }, (_, k) => lo + k))
const GB = cellsOf(49.9, -8, 60.9, 1.8)

// Runs the generated SQL against rows in memory: every `?` becomes its bound
// value, then each UNION part's WHERE is evaluated per row, ordered and
// limited like MySQL would (our SQL uses only these forms: buildSql, and the
// cap's buildCandidateSql and buildElSql)
function runSql({ sql, params }, rows) {
  let i = 0
  return sql.replace(/\?/g, () => `p[${i++}]`).replace(/ ORDER BY g, osm_type, osm_id$/, '').split(' UNION ALL ').flatMap(part => {
    if (part.startsWith('(')) part = part.slice(1, -1) // a UNION part: (SELECT ...)
    const m = /^SELECT (?:\/\*.*?\*\/ )?(?:(\d+) AS g, )?[\w, ]+? FROM \w+(?: FORCE INDEX \(\w+\))? WHERE (.+?)(?: ORDER BY osm_type, osm_id)?(?: LIMIT p\[(\d+)\])?$/.exec(part)
    const where = m[2]
      .replace(/(\w+) BETWEEN (p\[\d+\]) AND (p\[\d+\])/g, '(r.$1 >= $2 && r.$1 <= $3)')
      .replace(/(\w+)(?: COLLATE utf8mb4_0900_bin)? IN \(([^)]*)\)/g, '[$2].includes(r.$1)')
      .replace(/(?<![.\w])(\w+) (>=|<=|<|>) (p\[\d+\])/g, 'r.$1 $2 $3')
      .replace(/NOT \(/g, '!(')
      .replace(/(?<![.\w])(\w+) = (p\[\d+\]|1)/g, 'r.$1 === $2')
      .replace(/ AND /g, ' && ').replace(/ OR /g, ' || ')
    const match = new Function('r', 'p', `return ${where}`)
    return rows.filter(r => match(r, params))
      .sort((a, b) => a.osm_type - b.osm_type || a.osm_id - b.osm_id)
      .slice(0, m[3] === undefined ? Infinity : params[m[3]])
      .map(r => (m[1] === undefined ? r : { ...r, g: Number(m[1]) }))
  })
}

const TYPE = { 1: 'node', 2: 'way', 3: 'relation' }
// A pois row as the build writes it, from an Overpass-shaped element
function rowFor(el, { large = false } = {}) {
  const b = el.bounds || { minlat: el.lat, minlon: el.lon, maxlat: el.lat, maxlon: el.lon }
  const c = { lat: (b.minlat + b.maxlat) / 2, lon: (b.minlon + b.maxlon) / 2 }
  const tags = el.tags
  const k = key => tags[key] ?? null
  return {
    cell: large ? 0 : poiCell(c.lat, c.lon), osm_type: { node: 1, way: 2, relation: 3 }[el.type], osm_id: el.id, lat: c.lat, lon: c.lon,
    min_lat: b.minlat, min_lon: b.minlon, max_lat: b.maxlat, max_lon: b.maxlon,
    k_amenity: k('amenity'), k_tourism: k('tourism'), k_leisure: k('leisure'), k_historic: k('historic'),
    k_shop: k('shop'), k_natural: k('natural'), k_man_made: k('man_made'),
    has_name: tags.name || tags['name:en'] ? 1 : 0, has_name_tag: tags.name ? 1 : 0, has_wikidata: tags.wikidata ? 1 : 0,
    ...poiFeatures(el), el: JSON.stringify(el)
  }
}
function row(osm_type, osm_id, tags, { lat, lon, bounds }) {
  const type = TYPE[osm_type]
  return rowFor(bounds ? { type, id: osm_id, bounds, tags } : { type, id: osm_id, lat, lon, tags })
}
const tableAnswer = rows => (opts, params) => runSql({ sql: opts.sql, params }, rows)

// Lerwick last: the widest box in longitude
const CENTRES = [[51.5074, -0.1278], [53.959, -1.0815], [54.5973, -5.9301], [55.9533, -3.1883], [51.4816, -3.1791], [51.8787, -0.42], [60.155, -1.145]]
const RADII_KM = [5, 15, 30, 35, 75]
const CATEGORIES = [null, ...Object.keys(GOOD_CATEGORY_TYPES)]

function discoverQueries(build = buildDiscoverOverpassQuery) {
  return CENTRES.flatMap(([lat, lng]) => RADII_KM.flatMap(km => CATEGORIES.map(cat =>
    snapQueryBbox(build(lat, lng, km * 1000, cat).query))))
}

// Every id query the codebase sends, captured from the real callers
async function idQueries() {
  const sent = []
  const proxy = async (req, res) => { sent.push(req.body.query); res.status(200).json({ elements: [] }) }
  for (const id of ['n123', 'w456', 'r789', '1011']) await lookupPlace(id, '10.0.0.1', { proxy })
  const fetchSpy = vi.fn(async (url, init) => {
    sent.push(JSON.parse(init.body).query)
    return new Response(JSON.stringify({ elements: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchSpy)
  try {
    for (const id of ['n123', 'w456', 'r789', '1011']) await fetchPlaceById(id)
  } finally {
    vi.unstubAllGlobals()
  }
  return sent
}

describe('parseQuery: golden, every query the app emits', () => {
  it('parses every Discover query (all categories x 5/15/30/35/75 km, snapped)', () => {
    const queries = discoverQueries()
    expect(queries.length).toBe(CENTRES.length * RADII_KM.length * CATEGORIES.length)
    for (const q of queries) {
      const plan = parseQuery(q)
      expect(plan, q).not.toBeNull()
      expect(plan.kind).toBe('area')
      expect(plan.groups).toHaveLength(1)
      expect(plan.groups[0].limit).toBeNull()
    }
  })

  it('keeps the keys, values, types and name filter of a Discover query', () => {
    const q = snapQueryBbox(buildDiscoverOverpassQuery(51.5074, -0.1278, 75000, 'food').query)
    const plan = parseQuery(q)
    const [amenity, shop] = plan.groups[0].statements
    expect(amenity.types).toEqual([1, 2, 3]) // nwr: relations too (the British Museum is one)
    expect(amenity.keys.amenity).toContain('restaurant')
    expect(amenity.name).toBe(true) // >50 km adds ["name"]
    expect(shop.keys.shop).toContain('bakery')
    expect(plan.bbox.s).toBeLessThan(plan.bbox.n)
    const m = q.match(/\[bbox:([^\]]+)\]/)[1].split(',').map(Number)
    expect(plan.bbox).toEqual({ s: m[0], w: m[1], n: m[2], e: m[3] })
  })

  it('parses town page queries into 9 limited statements', () => {
    for (const [lat, lng] of CENTRES) {
      const plan = parseQuery(townOverpassQuery(lat, lng))
      expect(plan).not.toBeNull()
      expect(plan.groups.map(g => g.limit)).toEqual([150, 100, 60, 40, 30, 120, 100, 40, 150])
      expect(plan.groups[0].statements[0]).toMatchObject({ types: [1, 2, 3], name: true, wikidata: true })
      expect(plan.groups[3].statements[0].keys).toEqual({ amenity: ['place_of_worship'] })
      // notable libraries only
      expect(plan.groups[4].statements[0]).toMatchObject({ keys: { amenity: ['library'] }, wikidata: true })
    }
  })

  it('parses every typed id lookup; a bare-number union asks the DB for the node only', async () => {
    const queries = await idQueries()
    expect(queries).toHaveLength(8)
    const typed = [0, 1, 2, 4, 5, 6].map(i => queries[i])
    for (const q of typed) {
      const plan = parseQuery(q)
      expect(plan, q).not.toBeNull()
      expect(plan.kind).toBe('id')
    }
    expect(parseQuery(queries[0]).groups[0].statements).toEqual([{ type: 1, id: 123 }])
    // (node(N);way(N);): every DB row is named with a place tag, the best osmPick
    // score, and the node wins its ties, so a DB node N is the answer. A way is
    // never asked for: the DB holding only the way could lose to a node outside
    // the build, so no node row falls through to Overpass as before.
    for (const q of [queries[3], queries[7]]) {
      const plan = parseQuery(q)
      expect(plan, q).toMatchObject({ kind: 'id' })
      expect(plan.groups.flatMap(g => g.statements).every(s => s.type === 1)).toBe(true)
    }
    expect(parseQuery('[out:json];(node(5);way(6););out center;')).toBeNull() // different numbers: not a bare id
  })

  it('answers the 100 km box across mainland UK and refuses bigger boxes', () => {
    for (const [lat, lng] of CENTRES.slice(0, -1)) {
      expect(parseQuery(snapQueryBbox(buildDiscoverOverpassQuery(lat, lng, 100000, null).query))).not.toBeNull()
    }
    const cafe = 'nw["amenity"="cafe"];out center;'
    expect(parseQuery(`[out:json][bbox:-90,-180,90,180];${cafe}`)).toBeNull()
    expect(parseQuery(`[out:json][bbox:49.9,-8,60.9,1.8];${cafe}`)).toBeNull()
    expect(parseQuery(`[out:json][bbox:50,-1,52.6,0];${cafe}`)).toBeNull() // 2.6 deg tall
    expect(parseQuery(`[out:json][bbox:50,-2,51,1.6];${cafe}`)).toBeNull() // 3.6 deg wide
    expect(parseQuery(`[out:json][bbox:50,-2,52.5,1.5];${cafe}`)).not.toBeNull()
  })

  // Native builds in users' hands build their own queries (June 2026 build)
  const juneSource = (() => {
    try {
      return execSync('git show 7e93164:shared/overpassQuery.js', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      return null
    }
  })()
  it.skipIf(!juneSource)('parses every query the June native build emits', async () => {
    // Inside the project (vite won't import from the OS temp dir); gitignored
    const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
    const dir = join(root, 'node_modules', '.cache')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'roam-june-overpassQuery.mjs')
    writeFileSync(file, juneSource)
    const june = await import(/* @vite-ignore */ file)
    for (const q of discoverQueries(june.buildDiscoverOverpassQuery)) {
      expect(parseQuery(q), q).not.toBeNull()
    }
  })

  it('returns null for anything it cannot answer', () => {
    const bbox = '[out:json][timeout:20][bbox:51.4,-0.2,51.6,0.0];'
    const bad = [
      '[out:json];node(around:500,51.5,-0.12)["amenity"="cafe"];out center;',
      '[out:json];node(poly:"51.5 -0.1 51.6 -0.1 51.6 0")["amenity"="cafe"];out center;',
      '[out:json];area["name"="London"]->.a;node(area.a)["amenity"="cafe"];out center;',
      `${bbox}(nw["amenity"="cafe"];>;);out center;`,
      `${bbox}nw["amenity"="cafe"];out;`,
      `${bbox}nw["amenity"="cafe"];out meta;`,
      `${bbox}nw["cuisine"="pizza"];out center;`, // unknown key
      `${bbox}nw["name"];out center;`, // no key filter
      `${bbox}nw["amenity"~"^(cafe|pub)$",i];out center;`,
      `${bbox}nw["amenity"~"cafe"];out center;`, // unanchored regex
      `${bbox}nw["amenity"~"^(ca.e)$"];out center;`,
      `${bbox}nw["amenity"="cafe"]`, // no out
      `${bbox}(nw["amenity"="cafe"];nw["shop"="books"];);out tags bb 10;`, // limit on a union
      `${bbox}nw["amenity"="cafe"];node(1);out center;`,
      '[out:json][timeout:20];nw["amenity"="cafe"];out center;', // area query without bbox
      '[out:xml][bbox:51.4,-0.2,51.6,0.0];nw["amenity"="cafe"];out center;',
      '[out:json][bbox:51.6,-0.2,51.4,0.0];nw["amenity"="cafe"];out center;', // s > n
      '[out:json][maxsize:1000][bbox:51.4,-0.2,51.6,0.0];nw["amenity"="cafe"];out center;',
      '[out:json][timeout:20];();out center;', // the empty-types query
      '[out:json];(node(1);way(1));out center;',
      'garbage', '', null, 42
    ]
    for (const q of bad) expect(parseQuery(q), String(q)).toBeNull()
  })

  it('declines values the build does not extract (they would silently be missing)', () => {
    const bbox = '[out:json][bbox:51.4,-0.2,51.6,0.0];'
    expect(parseQuery(`${bbox}nw["amenity"~"^(cafe|bank)$"];out center;`)).toBeNull()
    expect(parseQuery(`${bbox}nw["amenity"="bank"];out center;`)).toBeNull()
    expect(parseQuery(`${bbox}nw["natural"="water"];out center;`)).not.toBeNull() // town-only extra
    expect(parseQuery(`${bbox}nw["amenity"~"^(cafe|pub)$"];out center;`)).not.toBeNull()
  })

  it('reads whitespace the way Overpass does', () => {
    const plan = parseQuery('[out:json] [timeout:20] [bbox:51.4,-0.2,51.6,0.0] ;\n(\n  nw[ "amenity" ~ "^(cafe|pub)$" ] [ "name" ] ;\n) ;\nout   tags\ncenter ;')
    expect(plan.groups[0].statements[0]).toMatchObject({ keys: { amenity: ['cafe', 'pub'] }, name: true })
  })
})

describe('SQL', () => {
  const q = '[out:json][timeout:20][bbox:51.45,-0.25,51.55,-0.05];(nw["amenity"~"^(cafe|pub)$"];nw["shop"="books"]["wikidata"];);out tags center;'

  it('binds every value and scans the large bucket plus one cell range per 0.1 degree row', () => {
    const plan = parseQuery(q)
    const { sql, params } = buildSql(plan)
    const ranges = cellRanges(51.45 - PAD, -0.25 - PAD, 51.55 + PAD, -0.05 + PAD)
    expect(ranges).toHaveLength(6)
    expect(sql).toBe(
      '(SELECT /*+ MAX_EXECUTION_TIME(800) */ 0 AS g, osm_type, osm_id, el FROM pois FORCE INDEX (PRIMARY) WHERE (' +
      Array(7).fill('cell BETWEEN ? AND ?').join(' OR ') + ') AND ' +
      'max_lat >= ? AND min_lat <= ? AND max_lon >= ? AND min_lon <= ? AND ' +
      '((osm_type IN (?,?) AND k_amenity COLLATE utf8mb4_0900_bin IN (?,?)) OR (osm_type IN (?,?) AND k_shop COLLATE utf8mb4_0900_bin IN (?) AND has_wikidata = 1)) ' +
      'ORDER BY osm_type, osm_id LIMIT ?) ORDER BY g, osm_type, osm_id')
    expect(params).toEqual([0, 0, ...ranges.flat(), 51.45, 51.55, -0.25, -0.05, 1, 2, 'cafe', 'pub', 1, 2, 'books', SCAN_ROWS + 1])
    expect(sql).not.toMatch(/cafe|books|51\.|\b\d{4,}\b/)
  })

  it('golden: a big park whose bounds cross a 5 km box is returned even with its centre outside', () => {
    const q = snapQueryBbox(buildDiscoverOverpassQuery(51.5074, -0.1278, 5000, 'nature').query)
    const plan = parseQuery(q)
    const { s, w, n, e } = plan.bbox
    const rows = [
      // centre 8 km north of the box edge, south edge 1 km inside it
      row(2, 1, { name: 'Big Park', leisure: 'park' }, { bounds: { minlat: n - 0.01, minlon: w + 0.05, maxlat: n + 0.15, maxlon: w + 0.1 } }),
      // same size, 1 km clear of the box
      row(2, 2, { name: 'Far Park', leisure: 'park' }, { bounds: { minlat: n + 0.01, minlon: w + 0.05, maxlat: n + 0.17, maxlon: w + 0.1 } }),
      row(1, 3, { name: 'Inside', leisure: 'park' }, { lat: (s + n) / 2, lon: (w + e) / 2 }),
      row(1, 4, { name: 'Outside', leisure: 'park' }, { lat: s - 0.01, lon: (w + e) / 2 }),
      row(1, 5, { name: 'Wrong kind', amenity: 'bank' }, { lat: (s + n) / 2, lon: (w + e) / 2 }),
      row(1, 6, { name: 'Case', leisure: 'Park' }, { lat: (s + n) / 2, lon: (w + e) / 2 })
    ]
    expect(rows[0].cell).not.toBe(poiCell(n - 0.001, w + 0.07)) // centred in another cell row
    const got = runSql(buildSql(plan), rows).map(r => r.osm_id)
    expect(got).toEqual([3, 1])
  })

  it('golden: ["name"] needs the name tag; a name:en-only row does not count', () => {
    const plan = parseQuery('[out:json][bbox:51.4,-0.2,51.6,0.0];nwr["amenity"="cafe"]["name"];out tags bb 10;')
    const rows = [
      row(1, 1, { name: 'Cafe', amenity: 'cafe' }, { lat: 51.5, lon: -0.1 }),
      row(1, 2, { 'name:en': 'Cafe EN', amenity: 'cafe' }, { lat: 51.5, lon: -0.1 })
    ]
    expect(runSql(buildSql(plan), rows).map(r => r.osm_id)).toEqual([1])
  })

  it('golden: an element wider than the pad (cell 0) is found for boxes it crosses only', () => {
    // Bristol Channel-like: 2.1 deg wide, stored in the large bucket, its east
    // edge inside the Cardiff box
    const channel = rowFor({ type: 'way', id: 9, bounds: { minlat: 51.1, minlon: -5.3, maxlat: 51.6, maxlon: -3.2 }, tags: { name: 'Bristol Channel', natural: 'bay' } }, { large: true })
    const nature = (lat, lng) => parseQuery(snapQueryBbox(buildDiscoverOverpassQuery(lat, lng, 5000, 'nature').query))
    const cardiff = nature(51.4816, -3.1791)
    const london = nature(51.5074, -0.1278)
    expect(runSql(buildSql(cardiff), [channel]).map(r => r.osm_id)).toEqual([9])
    expect(runSql(buildSql(london), [channel])).toEqual([])
    expect(isCovered(cardiff, { cells: new Set(GB) })).toBe(true) // coverage never needs cell 0
  })

  it('known approximation: an area whose bounds wrap the whole box is returned (bounds, not geometry)', () => {
    // A concave park can have members inside the box, so it is kept; the
    // shadow log's extra_db measures how often this adds places Overpass wouldn't
    const plan = parseQuery('[out:json][bbox:51.45,-0.25,51.55,-0.05];nwr["leisure"="park"]["name"];out tags bb 5;')
    const around = rowFor({ type: 'way', id: 1, bounds: { minlat: 51.4, minlon: -0.3, maxlat: 51.6, maxlon: 0 }, tags: { name: 'Round', leisure: 'park' } })
    expect(runSql(buildSql(plan), [around]).map(r => r.osm_id)).toEqual([1])
  })

  it("compares tag values with a NO PAD binary collation ('cafe ' is not 'cafe')", () => {
    const { sql } = buildSql(parseQuery(q))
    expect(sql).toContain('k_amenity COLLATE utf8mb4_0900_bin IN')
    expect(sql).not.toMatch(/utf8mb4_bin/)
  })

  it('runs a town page as ONE statement: a limited SELECT per output, UNION ALL, one hint', () => {
    const town = parseQuery(townOverpassQuery(51.7635, -0.2259))
    const { sql } = buildSql(town)
    const parts = sql.split(' UNION ALL ')
    expect(parts).toHaveLength(9)
    expect(sql.match(/MAX_EXECUTION_TIME/g)).toHaveLength(1)
    expect(parts[0]).toMatch(/^\(SELECT \/\*\+ MAX_EXECUTION_TIME\(800\) \*\/ 0 AS g,/)
    expect(parts[8]).toMatch(/^\(SELECT 8 AS g,.* LIMIT \?\) ORDER BY g, osm_type, osm_id$/)
    // ["name"] needs the name tag itself; has_name also counts name:en-only rows
    expect(parts[0]).toMatch(/has_name_tag = 1 AND has_wikidata = 1\)\) ORDER BY osm_type, osm_id LIMIT \?\)$/)
    // Regression: left to itself MySQL walked uq_osm for the LIMIT (York 24 s)
    // or full-scanned dense London (20 s); area reads must go through the cells
    for (const p of parts) expect(p).toContain('FROM pois FORCE INDEX (PRIMARY) WHERE (cell BETWEEN')

    const ids = parseQuery('[out:json][timeout:10];way(12);out body center;')
    expect(buildSql(ids)).toEqual({
      sql: '(SELECT /*+ MAX_EXECUTION_TIME(800) */ 0 AS g, osm_type, osm_id, el FROM pois WHERE ((osm_type = ? AND osm_id = ?)) ORDER BY osm_type, osm_id LIMIT ?) ORDER BY g, osm_type, osm_id',
      params: [2, 12, SCAN_ROWS + 1]
    })
  })

  it('applies each town statement its own limit, in output order, in one round trip', async () => {
    const town = parseQuery('[out:json][bbox:51.7,-0.3,51.8,-0.2];nwr["leisure"="park"]["name"];out tags bb 2;nwr["amenity"="cafe"]["name"];out tags bb 1;')
    const rows = [1, 2, 3].flatMap(i => [
      row(1, 10 + i, { name: `Park ${i}`, leisure: 'park' }, { lat: 51.75, lon: -0.25 }),
      row(1, 20 + i, { name: `Cafe ${i}`, amenity: 'cafe' }, { lat: 51.75, lon: -0.25 })
    ])
    poolQuery.mockClear()
    answer = tableAnswer(rows)
    const out = await queryPois(town)
    expect(out.ids).toEqual(['node/11', 'node/12', 'node/21'])
    expect(poolQuery).toHaveBeenCalledTimes(1)
  })

  it('only queries the POI tables', () => {
    const plan = parseQuery(q)
    expect(buildSql(plan, 'pois_staging').sql).toContain('FROM pois_staging')
    expect(() => buildSql(plan, 'users; DROP TABLE x')).toThrow()
  })

  it('sends a per-query timeout and builds the Overpass envelope from stored strings', async () => {
    poolQuery.mockClear()
    answer = async () => [{ osm_type: 1, osm_id: 5, el: '{"type":"node","id":5,"lat":51.5,"lon":-0.1,"tags":{"name":"A","amenity":"cafe"}}' }]
    const out = await queryPois(parseQuery(q), { osmTimestamp: '2026-09-27T02:15:00Z' })
    expect(poolQuery.mock.calls[0][0].timeout).toBe(2500)
    expect(out.n).toBe(1)
    expect(out.ids).toEqual(['node/5'])
    expect(JSON.parse(out.body)).toEqual({
      version: 0.6, generator: 'roam-poi-db',
      osm3s: { timestamp_osm_base: '2026-09-27T02:15:00Z', copyright: expect.stringContaining('ODbL') },
      elements: [{ type: 'node', id: 5, lat: 51.5, lon: -0.1, tags: { name: 'A', amenity: 'cafe' } }]
    })
  })
})

describe('the DB envelope reads the same as live Overpass in the real parsers', () => {
  const tags = { park: { name: 'Hatfield Park', leisure: 'park', wikidata: 'Q2' }, cafe: { name: 'Cafe Nero', amenity: 'cafe' } }
  const bounds = { minlat: 51.75, minlon: -0.24, maxlat: 51.77, maxlon: -0.22 }
  const center = { lat: 51.76, lon: -0.23 } // bbox centre, as the build stores it
  // What we store: nodes lat/lon; ways center + bounds
  const stored = [
    { type: 'node', id: 7, lat: 51.761, lon: -0.221, tags: tags.cafe },
    { type: 'way', id: 7, center, bounds, tags: tags.park }
  ]
  // Live Overpass: `out tags center` (Discover, previews) and `out tags bb` (town pages)
  const liveCenter = [stored[0], { type: 'way', id: 7, center, tags: tags.park }]
  const liveBb = [stored[0], { type: 'way', id: 7, bounds, tags: tags.park }]

  async function fromDb(ql) {
    answer = tableAnswer(stored.map(el => rowFor(el)))
    return JSON.parse((await queryPois(parseQuery(ql))).body)
  }

  it('parseOverpassResponse (Discover)', async () => {
    const db = await fromDb('[out:json][bbox:51.7,-0.3,51.8,-0.2];(nw["amenity"="cafe"];nw["leisure"="park"];);out tags center;')
    expect(parseOverpassResponse(db)).toEqual(parseOverpassResponse({ elements: liveCenter }))
    expect(parseOverpassResponse(db)).toHaveLength(2)
  })

  it('groupPlaces (town pages)', async () => {
    const db = await fromDb('[out:json][bbox:51.7,-0.3,51.8,-0.2];nwr["leisure"="park"]["name"];out tags bb 10;nwr["amenity"="cafe"]["name"];out tags bb 10;')
    const town = { name: 'Hatfield', lat: 51.76, lng: -0.22, countryCode: 'gb' }
    // Live derives a way's position from its bounds; the build stores that same
    // centre, so only float noise may differ
    const round = g => JSON.parse(JSON.stringify(g, (k, v) => (k === 'lat' || k === 'lng' ? Math.round(v * 1e6) / 1e6 : v)))
    expect(round(groupPlaces(db.elements, town))).toEqual(round(groupPlaces(liveBb, town)))
    expect(groupPlaces(db.elements, town).total).toBe(2)
  })

  it('pickPlaceElement (typed id previews), keeping only the element asked for', async () => {
    const db = await fromDb('[out:json][timeout:10];way(7);out tags center;')
    expect(db.elements).toEqual([stored[1]])
    const picked = pickPlaceElement(db.elements)
    const live = pickPlaceElement([liveCenter[1]])
    expect([picked.type, picked.id]).toEqual([live.type, live.id])
  })

  it('drops an id row whose stored element is not the one requested', async () => {
    answer = async () => [{ osm_type: 2, osm_id: 7, el: JSON.stringify({ ...stored[1], id: 8 }) }, { osm_type: 2, osm_id: 7, el: 'not json' }]
    expect((await queryPois(parseQuery('[out:json];way(7);out center;'))).n).toBe(0)
  })
})

describe('getPois: coverage, breaker, dedupe, LRU', () => {
  const Q = '[out:json][timeout:20][bbox:51.45,-0.25,51.55,-0.05];nw["amenity"="cafe"];out tags center;'
  const OUTSIDE = '[out:json][timeout:20][bbox:48.8,2.3,48.9,2.4];nw["amenity"="cafe"];out tags center;'
  const ROW = { osm_type: 1, osm_id: 5, el: '{"type":"node","id":5,"lat":51.5,"lon":-0.1,"tags":{"name":"A","amenity":"cafe"}}' }
  const plan = parseQuery(Q)
  // DB runs: each starts with today's statement through the pool
  const poiCalls = () => poolQuery.mock.calls.filter(c => c[0].sql.startsWith('(SELECT')).length
  // Coverage loaded, with no pois query yet
  const getCoverageLoaded = async () => {
    await getPois(parseQuery(OUTSIDE), OUTSIDE)
    poolQuery.mockClear()
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-27T12:00:00Z'))
    _resetPoiState()
    poolQuery.mockClear()
    build = { build_id: 'uk-20260927T0215Z', schema_version: POI_SCHEMA_VERSION, osm_timestamp: new Date('2026-09-27T02:15:00Z'), coverage: JSON.stringify(GB), features_version: FEATURES_VERSION }
    answer = async () => [ROW]
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('serves a covered query with the build id and OSM timestamp', async () => {
    const out = await getPois(plan, Q)
    expect(out).toMatchObject({ n: 1, buildId: 'uk-20260927T0215Z', cached: false })
    expect(JSON.parse(out.body).osm3s.timestamp_osm_base).toBe('2026-09-27T02:15:00Z')
  })

  it('declines bboxes outside coverage, a wrong schema version, or no active build', async () => {
    expect(await getPois(parseQuery(OUTSIDE), OUTSIDE)).toBeNull()
    expect(poiCalls()).toBe(0)
    _resetPoiState()
    build = { ...build, schema_version: POI_SCHEMA_VERSION + 1 }
    expect(await getPois(plan, Q)).toBeNull()
    _resetPoiState()
    build = null
    expect(await getPois(plan, Q)).toBeNull()
    expect(isCovered(plan, { cells: null })).toBe(false)
  })

  it('refreshes coverage every 5 minutes and keeps the last known one on error', async () => {
    await getPois(plan, Q)
    build = new Error('RDS down')
    vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1)
    expect(await getPois(plan, 'other key')).toMatchObject({ n: 1 })
    expect(poolQuery.mock.calls.filter(c => c[0].sql.includes('poi_builds'))).toHaveLength(2)
    expect(poolQuery.mock.calls[0][0].sql).toMatch(/^SELECT \/\*\+ MAX_EXECUTION_TIME\(800\) \*\//)
  })

  it('never waits for a coverage refresh once one load has happened (the refresh holds the SQL slot)', async () => {
    await getPois(plan, Q)
    vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1)
    const realQuery = poolQuery.getMockImplementation()
    let finish
    poolQuery.mockImplementation(async (opts, params) => (opts.sql.includes('poi_builds') ? new Promise(resolve => { finish = () => resolve([[build]]) }) : realQuery(opts, params)))
    try {
      // resolves although the refresh hangs; declined because the one slot is busy
      expect(await getPois(plan, 'k2')).toBeNull()
      expect(poiCalls()).toBe(1)
      finish()
      await vi.waitFor(async () => expect(await getPois(plan, 'k3')).toMatchObject({ n: 1 }))
    } finally {
      poolQuery.mockImplementation(realQuery)
    }
  })

  it('a failed coverage read never confirms a new generation: it stays closed until a read succeeds', async () => {
    await getPois(plan, Q, { gen: 0 })
    build = new Error('RDS down')
    for (let i = 0; i < 3; i++) {
      await getPois(plan, `x${i}`, { gen: 1 })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(await getPois(plan, `y${i}`, { gen: 1 })).toBeNull()
    }
    // retried after 30 s, not on every request
    expect(poolQuery.mock.calls.filter(c => c[0].sql.includes('poi_builds'))).toHaveLength(2)
    build = { build_id: 'uk-20260928T0215Z', schema_version: POI_SCHEMA_VERSION, osm_timestamp: '2026-09-28T02:15:00Z', coverage: GB }
    vi.setSystemTime(Date.now() + 30_001)
    await getPois(plan, 'kick', { gen: 1 })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await getPois(plan, 'z', { gen: 1 })).toMatchObject({ n: 1, buildId: 'uk-20260928T0215Z' })
  })

  it('a coverage read waits for the SQL slot and the deadline like any query', async () => {
    let release
    let gate; answer = () => (gate ||= new Promise(resolve => { release = () => resolve([ROW]) })) // one gate for every statement of the run
    await getCoverageLoaded()
    const first = getPois(plan, 'a')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1) // coverage now due
    await getPois(plan, 'b')
    expect(poolQuery.mock.calls.filter(c => c[0].sql.includes('poi_builds'))).toHaveLength(0) // slot busy
    release()
    await first
    _resetPoiState()
    poolQuery.mockClear()
    await getPois(plan, 'c', { deadlineAt: Date.now() + 150 })
    expect(poolQuery).not.toHaveBeenCalled() // too close to the deadline for even the coverage read
  })

  it('checks coverage from ranges without building a cell list', () => {
    const t = Date.now()
    expect(isCovered({ bbox: { s: 50, w: -2, n: 52.5, e: 1.5 } }, { cells: new Set(GB) })).toBe(true)
    expect(isCovered({ bbox: { s: 48.8, w: 2.3, n: 48.9, e: 2.4 } }, { cells: new Set(GB) })).toBe(false)
    expect(Date.now() - t).toBeLessThan(50)
  })

  it('takes the old path instead of serving an answer over the row scan bound', async () => {
    // Discover on a features build: over RANK_SCAN_ROWS candidates in phase 1, logged, and el is
    // never read for them (phase 2 never runs)
    answer = async () => Array.from({ length: RANK_SCAN_ROWS + 1 }, (_, i) => ({ ...ROW, osm_id: i }))
    expect(await getPois(plan, Q, { cap: true })).toBeNull()
    expect(poolQuery.mock.calls.some(c => c[0].sql.includes('uq_osm'))).toBe(false)
    expect(console.warn).toHaveBeenCalledWith(JSON.stringify({ evt: 'poi_cap_fallback', reason: 'too_dense', scanned: RANK_SCAN_ROWS + 1, limit: RANK_SCAN_ROWS }))
    _resetPoiState()
    // Any other unlimited plan (two outputs: not ranked) keeps the SCAN_ROWS bound
    const two = '[out:json][bbox:51.45,-0.25,51.55,-0.05];nw["amenity"="cafe"];out tags center;nw["amenity"="pub"];out tags center;'
    answer = async () => Array.from({ length: SCAN_ROWS + 1 }, (_, i) => ({ ...ROW, osm_id: i }))
    expect(isRankable(parseQuery(two))).toBe(false)
    expect(await getPois(parseQuery(two), two)).toBeNull()
    expect(breakerState()).toBe('closed')
  })

  it('caps on bytes: over 4 MB (multi-byte names counted as bytes) takes the old path', async () => {
    // 1000 rows of ~4.5 KB in UTF-8 but only ~1.5 KB in UTF-16 code units
    const el = JSON.stringify({ type: 'node', id: 5, lat: 51.5, lon: -0.1, tags: { name: '\u6771'.repeat(1500), amenity: 'cafe' } })
    expect(Buffer.byteLength(el) * 1000).toBeGreaterThan(MAX_BODY_BYTES)
    expect(el.length * 1000).toBeLessThan(MAX_BODY_BYTES)
    answer = async () => Array.from({ length: 1000 }, (_, i) => ({ ...ROW, osm_id: i, el }))
    expect(await getPois(plan, Q)).toBeNull()
  })

  it('remembers an over-cap tile for 10 minutes instead of re-scanning', async () => {
    answer = async () => Array.from({ length: RANK_SCAN_ROWS + 1 }, (_, i) => ({ ...ROW, osm_id: i }))
    await getPois(plan, Q)
    expect(await getPois(plan, Q)).toBeNull()
    expect(await getPois(plan, Q)).toBeNull() // shadow calls go through the same check
    expect(poiCalls()).toBe(1)
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1)
    await getPois(plan, Q)
    expect(poiCalls()).toBe(2)
  })

  it('a new poiGen reloads coverage and never serves or reuses answers from the old generation', async () => {
    await getPois(plan, Q, { gen: 0 })
    expect(await getPois(plan, Q, { gen: 0 })).toMatchObject({ cached: true })
    build = { ...build, build_id: 'uk-20260920T0215Z' } // rolled back
    await getPois(plan, 'kick', { gen: 1 }) // starts the gen 1 reload (served only once it's confirmed)
    await vi.waitFor(() => expect(poolQuery.mock.calls.filter(c => c[0].sql.includes('poi_builds'))).toHaveLength(2))
    await new Promise(resolve => setTimeout(resolve, 0))
    const fresh = await getPois(plan, Q, { gen: 1 })
    expect(fresh).toMatchObject({ cached: false, buildId: 'uk-20260920T0215Z' })
    expect(await getPois(plan, Q, { gen: 0 })).toBeNull() // a stale flag read can't reach the old answers
  })

  it('admits one query at a time per instance: a second key falls back at once', async () => {
    let release
    let gate; answer = () => (gate ||= new Promise(resolve => { release = () => resolve([ROW]) })) // one gate for every statement of the run
    await getCoverageLoaded()
    const first = getPois(plan, 'a')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    expect(await getPois(plan, 'b')).toBeNull()
    expect(poiCalls()).toBe(1)
    release()
    expect(await first).toMatchObject({ n: 1 })
    answer = async () => [ROW]
    expect(await getPois(plan, 'b')).toMatchObject({ n: 1 }) // free again
  })

  it('submits no SQL with under 200 ms left before the deadline', async () => {
    await getCoverageLoaded()
    expect(await getPois(plan, Q, { deadlineAt: Date.now() + 150 })).toBeNull()
    expect(poiCalls()).toBe(0)
    expect(await getPois(plan, Q, { deadlineAt: Date.now() + 1000 })).toMatchObject({ n: 1 })
  })

  it('a query slower than the deadline counts as a breaker failure even if it succeeds', async () => {
    answer = async () => { vi.setSystemTime(Date.now() + POI_DEADLINE + 1); return [ROW] }
    for (let i = 0; i < 3; i++) await getPois(plan, `slow${i}`)
    expect(breakerState()).toBe('open')
  })

  it('the LRU is a byte budget: a capped dense answer (~1.1 MB) is cached, a body over 2 MB is not', async () => {
    const sized = (id, kb) => ({ ...ROW, osm_id: id, el: JSON.stringify({ type: 'node', id, lat: 51.5, lon: -0.1, tags: { name: '\u6771'.repeat(kb * 1000 / 3), amenity: 'cafe' } }) })
    // 1.1 MB in UTF-8 bytes (a third of that in characters): kept
    answer = async () => [sized(5, 1100)]
    expect((await getPois(plan, 'london')).cached).toBe(false)
    expect(await getPois(plan, 'london')).toMatchObject({ cached: true })
    expect(lruUsage().bytes).toBeGreaterThan(1_100_000)
    // over LRU_ENTRY_MAX_BYTES: served, never kept
    answer = async () => [sized(6, 2100)]
    expect((await getPois(plan, 'huge')).cached).toBe(false)
    expect((await getPois(plan, 'huge')).cached).toBe(false)
    expect(LRU_ENTRY_MAX_BYTES).toBe(2_000_000)
    expect(poiCalls()).toBe(3)
  })

  it('the LRU evicts least recently used answers to stay within its byte budget', async () => {
    const mb = id => ({ ...ROW, osm_id: id, el: JSON.stringify({ type: 'node', id, lat: 51.5, lon: -0.1, tags: { name: 'x'.repeat(1_500_000), amenity: 'cafe' } }) })
    const fits = Math.floor(LRU_BUDGET_BYTES / 1_500_100) // 10 bodies of ~1.5 MB
    for (let i = 0; i < fits; i++) {
      answer = async () => [mb(i)]
      await getPois(plan, `k${i}`)
    }
    expect(lruUsage().entries).toBe(fits)
    expect(await getPois(plan, 'k0')).toMatchObject({ cached: true }) // k0 is now the most recent
    answer = async () => [mb(99)]
    await getPois(plan, 'k-new')
    expect(lruUsage().bytes).toBeLessThanOrEqual(LRU_BUDGET_BYTES)
    expect(lruUsage().entries).toBe(fits)
    const calls = poiCalls()
    expect(await getPois(plan, 'k0')).toMatchObject({ cached: true })
    expect(await getPois(plan, 'k-new')).toMatchObject({ cached: true })
    expect(await getPois(plan, 'k1')).toMatchObject({ cached: false }) // the least recently used went
    expect(poiCalls()).toBe(calls + 1)
  })

  it('dedupes identical in-flight queries and serves repeats from the LRU', async () => {
    const [a, b] = await Promise.all([getPois(plan, Q), getPois(plan, Q)])
    expect(a.body).toBe(b.body)
    expect(poiCalls()).toBe(1)
    expect(await getPois(plan, Q)).toMatchObject({ cached: true, n: 1 })
    expect(poiCalls()).toBe(1)
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1)
    await getPois(plan, Q)
    expect(poiCalls()).toBe(2)
  })

  it('opens after 3 failures, half-opens after 60 s with one probe, closes on success', async () => {
    answer = async () => { throw new Error('timeout') }
    for (let i = 0; i < 3; i++) expect(await getPois(plan, `k${i}`)).toBeNull()
    expect(breakerState()).toBe('open')
    expect(await getPois(plan, 'k3')).toBeNull()
    expect(poiCalls()).toBe(3) // open: no query at all

    vi.setSystemTime(Date.now() + 60 * 1000)
    expect(breakerState()).toBe('half-open')
    let release
    let gate; answer = () => (gate ||= new Promise(resolve => { release = () => resolve([ROW]) })) // one gate for every statement of the run
    const probe = getPois(plan, 'probe')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    expect(await getPois(plan, 'second')).toBeNull() // only one probe at a time
    release()
    expect(await probe).toMatchObject({ n: 1 })
    expect(breakerState()).toBe('closed')
  })

  it('a failed half-open probe re-opens for another 60 s', async () => {
    answer = async () => { throw new Error('timeout') }
    for (let i = 0; i < 3; i++) await getPois(plan, `k${i}`)
    vi.setSystemTime(Date.now() + 60 * 1000)
    expect(await getPois(plan, 'probe')).toBeNull()
    expect(breakerState()).toBe('open')
    expect(poiCalls()).toBe(4)
  })

  it('0 rows is an answer, not a failure (and is not cached)', async () => {
    answer = async () => []
    for (let i = 0; i < 4; i++) expect(await getPois(plan, Q)).toMatchObject({ n: 0 })
    expect(breakerState()).toBe('closed')
    expect(poiCalls()).toBe(4)
  })
})

describe('relevance cap: dense Discover answers (shared/poiRank.mjs, two phases)', () => {
  // A dense, varied table inside a 5 km London Discover box: cafes, pubs, parks,
  // museums, a few blacklisted and private places, nodes and ways, some with hours
  const Q = snapQueryBbox(buildDiscoverOverpassQuery(51.5074, -0.1278, 5000, null).query)
  const plan = parseQuery(Q)
  const { s, w, n, e } = plan.bbox
  function denseRows(count) {
    let seed = 7
    const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822519) + 12345 | 0) >>> 0) / 2 ** 32
    // all in the default deck's types (fast_food left it in favour of dog parks: see shared/overpassQuery.js)
    const kinds = [{ amenity: 'cafe' }, { amenity: 'pub' }, { amenity: 'restaurant' }, { leisure: 'park' }, { amenity: 'biergarten' },
      { amenity: 'bar' }, { shop: 'bakery' }, { amenity: 'ice_cream' }]
    return Array.from({ length: count }, (_, i) => {
      const lat = s + rnd() * (n - s)
      const lon = w + rnd() * (e - w)
      const tags = { name: `Place ${i}`, ...kinds[i % kinds.length] }
      if (rnd() < 0.4) tags.opening_hours = rnd() < 0.5 ? 'Mo-Su 08:00-18:00' : 'Mo-Sa 17:00-23:30'
      if (rnd() < 0.2) tags.website = 'https://example.org'
      if (rnd() < 0.05) tags.wikidata = `Q${i}`
      if (rnd() < 0.02) tags.access = 'private'
      if (rnd() < 0.05) tags.brand = 'Costa'
      const way = i % 5 === 0
      const el = way
        ? { type: 'way', id: 100000 + i, center: { lat, lon }, bounds: { minlat: lat - 0.001, minlon: lon - 0.001, maxlat: lat + 0.001, maxlon: lon + 0.001 }, tags }
        : { type: 'node', id: 100000 + i, lat, lon, tags }
      return rowFor(el)
    })
  }
  const statements = () => poolQuery.mock.calls.map(c => c[0].sql).filter(q => !q.includes('poi_builds'))
  const TS = '2026-09-27T02:15:00Z'
  const FEATURES = { features: true, osmTimestamp: TS, buildId: 'uk-20260927T0215Z' } // the build pois holds (its COMMENT)

  beforeEach(() => {
    _resetPoiState()
    poolQuery.mockClear()
    connQuery.mockClear()
    getConnection.mockClear()
    Object.assign(conns, { opened: 0, released: 0, destroyed: 0 })
    build = { build_id: 'uk-20260927T0215Z', schema_version: POI_SCHEMA_VERSION, osm_timestamp: new Date(TS), coverage: JSON.stringify(GB), features_version: FEATURES_VERSION }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('Discover plans (one unlimited output over a bbox) are ranked; towns and id lookups are not', () => {
    expect(isRankable(plan)).toBe(true)
    expect(isRankable(parseQuery(townOverpassQuery(51.7635, -0.2259)))).toBe(false)
    expect(isRankable(parseQuery('[out:json][timeout:10];way(12);out body center;'))).toBe(false)
  })

  it('tiled and wide queries are never capped: 35 km tiles (the app\'s > 42 km search) and anything >= 34.5 km', async () => {
    const q = (lat, lng, m, cat = null) => parseQuery(snapQueryBbox(buildDiscoverOverpassQuery(lat, lng, m, cat).query))
    for (const km of [5, 15, 30]) expect(isRankable(q(51.5074, -0.1278, km * 1000)), `${km} km`).toBe(true)
    for (const km of [35, 42, 75]) expect(isRankable(q(51.5074, -0.1278, km * 1000)), `${km} km`).toBe(false)
    // the exact tiles fetchWithTiling sends for a 60 km search: all 35 km, all uncapped
    const lat = 51.5074
    const lng = -0.1278
    const d = 30000 / 111320
    for (const [la, ln] of [[lat, lng], [lat + d, lng], [lat - d, lng], [lat, lng + d / Math.cos(lat * Math.PI / 180)]]) {
      expect(isRankable(q(la, ln, 35000))).toBe(false)
    }
    // and a dense tile on a features build is served in full, as today
    answer = tableAnswer(denseRows(4500))
    const tile = q(lat, lng, 35000)
    const out = await queryPois(tile, FEATURES)
    expect(out.scanned).toBeUndefined()
    expect(getConnection).not.toHaveBeenCalled()
    expect(MAX_CAP_RADIUS_KM).toBe(34.5)
  })

  it('phase 1 has the same WHERE as today, reads no el, and goes through the covering index', () => {
    const today = buildSql(plan)
    const p1 = buildCandidateSql(plan)
    expect(p1.sql).toMatch(/^SELECT \/\*\+ MAX_EXECUTION_TIME\(800\) \*\/ osm_type, osm_id, min_lat, max_lat, min_lon, max_lon, q, cat, flags FROM pois FORCE INDEX \(ix_rank\) WHERE /)
    expect(p1.sql).not.toMatch(/\bel\b|ORDER BY/)
    const where = q => /WHERE (.*?)(?: ORDER BY| LIMIT)/.exec(q)[1]
    expect(where(p1.sql)).toBe(where(today.sql))
    expect(p1.params).toEqual([...today.params.slice(0, -1), RANK_SCAN_ROWS + 1])
    // and it picks the same rows, on a table with bbox-crossing ways and filtered-out kinds
    const rows = [...denseRows(300),
      row(2, 1, { name: 'Big Park', leisure: 'park' }, { bounds: { minlat: n - 0.01, minlon: w + 0.05, maxlat: n + 0.15, maxlon: w + 0.1 } }),
      row(1, 5, { name: 'Wrong kind', amenity: 'bank' }, { lat: (s + n) / 2, lon: (w + e) / 2 })]
    const ids = list => list.map(r => `${r.osm_type}/${r.osm_id}`).sort()
    expect(ids(runSql(p1, rows))).toEqual(ids(runSql(today, rows)))
    expect(ids(runSql(p1, rows))).toContain('2/1')
    expect(ids(runSql(p1, rows))).not.toContain('1/5')
  })

  it('phase 2 fetches el by (osm_type, osm_id) through uq_osm', () => {
    const { sql, params } = buildElSql(2, [7, 8, 9])
    expect(sql).toBe('SELECT /*+ MAX_EXECUTION_TIME(800) */ osm_type, osm_id, el FROM pois FORCE INDEX (uq_osm) WHERE osm_type = ? AND osm_id IN (?,?,?)')
    expect(params).toEqual([2, 7, 8, 9])
    expect(() => buildElSql(1, [1], 'users')).toThrow()
  })

  it('PARITY: at or under CAP rows the body is byte-identical to today: an index-only probe, then today\'s exact statement', async () => {
    const rows = denseRows(CAP)
    answer = tableAnswer(rows)
    const capped = await queryPois(plan, FEATURES)
    const today = await (async () => { poolQuery.mockClear(); return queryPois(plan, { osmTimestamp: TS }) })() // cap off: today
    expect(poolQuery.mock.calls.map(c => c[0].sql)).toEqual([buildSql(plan).sql]) // cap off: exactly today, one statement
    expect(capped.n).toBe(CAP)
    expect(capped.body).toBe(today.body)
    expect(capped.scanned).toBeUndefined()
    poolQuery.mockClear()
    await queryPois(plan, FEATURES)
    expect(getConnection).toHaveBeenCalledTimes(0) // no transaction
    const sent = poolQuery.mock.calls
    expect(sent).toHaveLength(2)
    // 1. the probe: ix_rank only, no el, stops at CAP + 1
    expect(sent[0][0].sql).toBe(buildProbeSql(plan).sql)
    expect(sent[0][0].sql).toMatch(/^SELECT \/\*\+ MAX_EXECUTION_TIME\(800\) \*\/ osm_type FROM pois FORCE INDEX \(ix_rank\) WHERE .* LIMIT \?$/)
    expect(sent[0][0].sql).not.toMatch(/\bel\b/)
    expect(sent[0][1].at(-1)).toBe(CAP + 1)
    // 2. today's statement, today's params
    expect(sent[1][0].sql).toBe(buildSql(plan).sql)
    expect(sent[1][1]).toEqual(buildSql(plan).params)
    const els = runSql(buildSql(plan), rows).map(r => r.el)
    expect(capped.body).toBe('{"version":0.6,"generator":"roam-poi-db","osm3s":{"timestamp_osm_base":"2026-09-27T02:15:00Z","copyright":' +
      `${JSON.stringify('The data included in this document is from www.openstreetmap.org. The data is made available under ODbL.')}},"elements":[${els.join(',')}]}`)
  })

  it('poiCapPct off (getPois without cap): a dense tile on a features build takes today\'s path, no probe', async () => {
    answer = tableAnswer(denseRows(4500))
    const out = await getPois(plan, Q)
    expect(out).toMatchObject({ n: 4500, cached: false })
    expect(out.scanned).toBeUndefined()
    expect(statements()).toEqual([buildSql(plan).sql])
  })

  it('a build without features (older build, or a Vercel rollback target) is served exactly as today: uncapped', async () => {
    answer = tableAnswer(denseRows(4500))
    for (const features_version of [null, 0, FEATURES_VERSION + 1]) {
      _resetPoiState()
      poolQuery.mockClear()
      build = { ...build, features_version }
      const out = await getPois(plan, Q, { cap: true }) // the cap requested, and refused by the build
      expect(out).toMatchObject({ n: 4500, cached: false })
      expect(out.scanned).toBeUndefined()
      expect(statements()).toEqual([buildSql(plan).sql]) // today's statement, today's SCAN_ROWS bound
      expect(poolQuery.mock.calls.find(c => c[0].sql.startsWith('(SELECT'))[1].at(-1)).toBe(SCAN_ROWS + 1)
    }
    expect(getConnection).not.toHaveBeenCalled()
  })

  it('CAP: over CAP rows serves exactly the rankCap choice, in (osm_type, osm_id) order, same envelope', async () => {
    const rows = denseRows(4500)
    answer = tableAnswer(rows)
    const out = await queryPois(plan, FEATURES)
    expect(out.n).toBe(CAP)
    expect(out.scanned).toBe(4500)
    expect(out.rankMs).toBeTypeOf('number')
    const sorted = runSql(buildSql(plan), rows) // today's order
    // ranked from the snapped bbox centre, with half a snap cell of slack for the phones sharing it
    const expected = rankCap(sorted, { lat: (s + n) / 2, lng: (w + e) / 2 }, CAP, SNAP_GRID_DEGREES / 2)
    expect(out.ids).toEqual(expected.map(r => `${{ 1: 'node', 2: 'way', 3: 'relation' }[r.osm_type]}/${r.osm_id}`))
    const body = JSON.parse(out.body)
    expect(Object.keys(body)).toEqual(['version', 'generator', 'osm3s', 'elements'])
    expect(body.elements).toEqual(expected.map(r => JSON.parse(r.el)))
    const order = body.elements.map(el => [{ node: 1, way: 2, relation: 3 }[el.type], el.id])
    expect(order).toEqual([...order].sort((a, b) => a[0] - b[0] || a[1] - b[1]))
  })

  it('dense: one probe statement, then both phases on one connection in one short read-only transaction', async () => {
    answer = tableAnswer(denseRows(4500))
    await queryPois(plan, FEATURES)
    const sqls = statements()
    expect(sqls[0]).toBe(buildProbeSql(plan).sql) // the probe (CAP + 1 rows says "dense"); no el read
    expect(poolQuery.mock.calls[0][1].at(-1)).toBe(CAP + 1)
    expect(sqls.filter(q => /\bel FROM/.test(q)).every(q => q.includes('uq_osm'))).toBe(true) // el only for the chosen
    expect(connQuery.mock.calls.map(c => c[0].sql)).toEqual(sqls.slice(1))
    // server-side bounds first, so MySQL itself ends a transaction this function abandons
    expect(sqls[1]).toBe('SET SESSION wait_timeout = 5, lock_wait_timeout = 2, innodb_lock_wait_timeout = 2, max_execution_time = 800')
    expect(sqls[2]).toBe('START TRANSACTION READ ONLY')
    expect(sqls[3]).toContain('FORCE INDEX (ix_rank)')
    // holding phase 1's metadata lock: which build IS this table? (its COMMENT)
    expect(sqls[4]).toBe(TABLE_BUILD_SQL)
    const phase2 = sqls.slice(5, -2)
    expect(phase2.length).toBeGreaterThanOrEqual(3) // 3000 ids, <= 1000 per statement, per osm_type
    for (const q of phase2) {
      expect(q).toMatch(/FORCE INDEX \(uq_osm\) WHERE osm_type = \? AND osm_id IN \(/)
      expect(q.match(/\?/g).length - 1).toBeLessThanOrEqual(1000)
      expect(q).toMatch(/^SELECT \/\*\+ MAX_EXECUTION_TIME\(800\) \*\//)
    }
    expect(sqls.at(-2)).toBe('ROLLBACK')
    // the pooled connection goes back with the server's own settings
    expect(sqls.at(-1)).toMatch(/^SET SESSION wait_timeout = @@GLOBAL.wait_timeout, lock_wait_timeout = @@GLOBAL.lock_wait_timeout, innodb_lock_wait_timeout = @@GLOBAL.innodb_lock_wait_timeout, max_execution_time = @@GLOBAL.max_execution_time$/)
    expect(conns).toEqual({ opened: 1, released: 1, destroyed: 0 })
  })

  it('DETERMINISM: the same table gives a byte-identical body whatever order the DB returns candidates in', async () => {
    const rows = denseRows(4500)
    answer = tableAnswer(rows)
    const a = await queryPois(plan, FEATURES)
    answer = (opts, params) => [...runSql({ sql: opts.sql, params }, rows)].reverse()
    const b = await queryPois(plan, FEATURES)
    expect(b.body).toBe(a.body)
  })

  it('any error inside the transaction DESTROYS the connection (no ROLLBACK queued behind a running statement)', async () => {
    const rows = denseRows(4500)
    for (const failOn of ['q, cat, flags FROM', 'uq_osm']) {
      poolQuery.mockClear()
      Object.assign(conns, { opened: 0, released: 0, destroyed: 0 })
      answer = (opts, params) => {
        if (opts.sql.includes(failOn)) throw Object.assign(new Error('Query inactivity timeout'), { code: 'PROTOCOL_SEQUENCE_TIMEOUT' })
        return runSql({ sql: opts.sql, params }, rows)
      }
      await expect(queryPois(plan, FEATURES)).rejects.toThrow(/inactivity/)
      expect(conns).toEqual({ opened: 1, released: 0, destroyed: 1 })
      expect(statements()).not.toContain('ROLLBACK')
    }
  })

  it('a failed ROLLBACK or settings restore destroys the connection: it is never reused', async () => {
    const rows = denseRows(4500)
    for (const failing of ['ROLLBACK', 'SET SESSION wait_timeout = @@GLOBAL']) {
      Object.assign(conns, { opened: 0, released: 0, destroyed: 0 })
      connQuery.mockImplementation(async (opts, params) => {
        if (opts.sql.startsWith(failing)) throw Object.assign(new Error('Connection lost'), { code: 'PROTOCOL_CONNECTION_LOST', fatal: true })
        return poolQuery(opts, params)
      })
      answer = tableAnswer(rows)
      try {
        await expect(queryPois(plan, FEATURES)).rejects.toThrow(/Connection lost/)
      } finally {
        connQuery.mockImplementation((...args) => poolQuery(...args))
      }
      expect(conns).toEqual({ opened: 1, released: 0, destroyed: 1 })
    }
  })

  it('a paused reader: the function freezes mid-transaction; the session was already bounded server-side', async () => {
    // Fluid suspends the instance inside phase 2. Nothing client-side can end the
    // transaction now, so the settings sent before START TRANSACTION are what free the
    // metadata lock: MySQL closes a session idle for wait_timeout (5 s) seconds
    const rows = denseRows(4500)
    let frozen
    answer = (opts, params) => (opts.sql.includes('uq_osm') ? new Promise(() => { frozen = true }) : runSql({ sql: opts.sql, params }, rows))
    const pending = queryPois(plan, FEATURES)
    await vi.waitFor(() => expect(frozen).toBe(true))
    const sent = connQuery.mock.calls.map(c => c[0].sql)
    expect(sent.indexOf('SET SESSION wait_timeout = 5, lock_wait_timeout = 2, innodb_lock_wait_timeout = 2, max_execution_time = 800'))
      .toBeLessThan(sent.indexOf('START TRANSACTION READ ONLY'))
    expect(sent.indexOf('START TRANSACTION READ ONLY')).toBeGreaterThan(-1)
    // (the loader side: a RENAME blocked by it times out after 5 s and retries; tests/unit/api/poiLoad.test.js)
    void pending
  })

  it('a chosen row missing in phase 2 is an error (never a silently short answer)', async () => {
    const rows = denseRows(4500)
    answer = (opts, params) => { const got = runSql({ sql: opts.sql, params }, rows); return opts.sql.includes('uq_osm') ? got.slice(1) : got }
    await expect(queryPois(plan, FEATURES)).rejects.toThrow(/phase 2 read/)
    expect(conns.destroyed).toBe(1)
  })

  it('deadlines: the caller\'s, and the transaction\'s own bound when there is none (shadow)', async () => {
    const rows = denseRows(4500)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      for (const [opts, late] of [[{ deadlineAt: Date.now() + 1000 }, 1000], [{}, 2000]]) {
        poolQuery.mockClear()
        const start = Date.now()
        answer = (o, params) => {
          if (o.sql.includes('q, cat, flags FROM')) vi.setSystemTime(start + late) // phase 1 took the whole budget
          return runSql({ sql: o.sql, params }, rows)
        }
        await expect(queryPois(plan, { ...FEATURES, ...opts })).rejects.toThrow(/deadline/)
        expect(statements().some(q => q.includes('uq_osm'))).toBe(false)
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('getPois: a capped answer is served, cached under the byte budget, and counted a success by both breakers', async () => {
    answer = tableAnswer(denseRows(4500))
    const first = await getPois(plan, Q, { cap: true })
    expect(first).toMatchObject({ n: CAP, scanned: 4500, cached: false, buildId: 'uk-20260927T0215Z' })
    expect(Object.keys(first.timings)).toEqual(['probe', 'candidates', 'rank', 'el'])
    expect(await getPois(plan, Q, { cap: true })).toMatchObject({ n: CAP, cached: true, body: first.body })
    expect([breakerState(), capBreakerState()]).toEqual(['closed', 'closed'])
    expect(lruUsage().entries).toBe(1)
    // capped and uncapped answers are cached apart: cap off gets today's (full) answer
    expect(await getPois(plan, Q)).toMatchObject({ n: 4500, cached: false })
  })

  it('capped failures and slowness trip only the cap breaker: towns keep the DB, dense tiles go uncapped', async () => {
    const rows = denseRows(4500)
    answer = (opts, params) => {
      if (opts.sql.includes('q, cat, flags FROM')) throw Object.assign(new Error('Query execution was interrupted'), { errno: 3024 })
      return runSql({ sql: opts.sql, params }, rows)
    }
    for (let i = 0; i < 3; i++) expect(await getPois(plan, `dense${i}`, { cap: true })).toBeNull()
    expect([breakerState(), capBreakerState()]).toEqual(['closed', 'open'])
    // the cap breaker open: the dense tile is served uncapped (today's statement, no probe)
    poolQuery.mockClear()
    const out = await getPois(plan, 'dense-again', { cap: true })
    expect(out).toMatchObject({ n: 4500 })
    expect(statements()).toEqual([buildSql(plan).sql])
    // too slow counts as a cap failure too, never a shared one
    _resetPoiState()
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      // capped runs inside the cap's own budget (1.5 s < POI_CAP_DEADLINE_MS) are successes
      answer = (opts, params) => {
        if (opts.sql.includes('q, cat, flags FROM')) vi.setSystemTime(Date.now() + 1500)
        return runSql({ sql: opts.sql, params }, rows)
      }
      for (let i = 0; i < 3; i++) expect(await getPois(plan, `ok${i}`, { cap: true })).toMatchObject({ n: CAP })
      expect([breakerState(), capBreakerState()]).toEqual(['closed', 'closed'])
      // each capped run takes 2.6 s (past POI_CAP_DEADLINE_MS, and the transaction's own 2 s
      // bound ends it): the cap's failure only
      answer = (opts, params) => {
        if (opts.sql.includes('q, cat, flags FROM')) vi.setSystemTime(Date.now() + 2600)
        return runSql({ sql: opts.sql, params }, rows)
      }
      for (let i = 0; i < 3; i++) expect(await getPois(plan, `slow${i}`, { cap: true })).toBeNull()
      expect([breakerState(), capBreakerState()]).toEqual(['closed', 'open'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('the table is not the build whose features we trust (a swap or rollback since coverage was read): uncapped, logged', async () => {
    const rows = denseRows(4500)
    answer = tableAnswer(rows)
    for (const owner of ['uk-20260920T0215Z', '']) { // another build; a table with no build stamp
      _resetPoiState()
      poolQuery.mockClear()
      tableOwner = owner
      try {
        const out = await getPois(plan, Q, { cap: true })
        expect(out).toMatchObject({ n: 4500, capFallback: 'build_mismatch' })
        expect(statements().some(q => q.includes('uq_osm'))).toBe(false)
        expect(capBreakerState()).toBe('closed')
      } finally {
        tableOwner = null
      }
    }
    expect(console.warn).toHaveBeenCalledWith(JSON.stringify({ evt: 'poi_cap_fallback', reason: 'build_mismatch', scanned: 4500, table: 'uk-20260920T0215Z' }))
  })

  it.each([
    ['ix_rank missing (before phase12)', Object.assign(new Error("Key 'ix_rank' doesn't exist in table 'pois'"), { errno: 1176 })],
    ['a server timeout', Object.assign(new Error('maximum statement execution time exceeded'), { errno: 3024 })],
    ['a SQL error', Object.assign(new Error('You have an error in your SQL syntax'), { errno: 1064 })],
  ])('the PROBE failing (%s) is the cap\'s alone: the shared breaker never moves, uncapped serving carries on', async (_label, failure) => {
    answer = (opts, params) => {
      if (opts.sql.includes('FORCE INDEX (ix_rank)')) throw failure
      return runSql({ sql: opts.sql, params }, denseRows(4500))
    }
    for (let i = 0; i < 3; i++) expect(await getPois(plan, `probe${i}`, { cap: true })).toBeNull()
    expect([breakerState(), capBreakerState()]).toEqual(['closed', 'open'])
    // the cap breaker open: the same dense tile, cap requested, is served uncapped without probing
    expect(await getPois(plan, 'probe-after', { cap: true })).toMatchObject({ n: 4500 })
    // cap off (poiCapPct 0) never probed at all, and is served as today
    expect(await getPois(plan, 'served', { cap: false })).toMatchObject({ n: 4500 })
  })

  it('probe SLOWNESS is the cap\'s too, and within the cap the probe\'s time never counts against today\'s statement', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const rows = denseRows(CAP) // within the cap: probe, then today's statement
      answer = (opts, params) => {
        if (opts.sql.includes('FORCE INDEX (ix_rank)')) vi.setSystemTime(Date.now() + 2600) // a slow probe
        return runSql({ sql: opts.sql, params }, rows)
      }
      for (let i = 0; i < 3; i++) expect(await getPois(plan, `slowprobe${i}`, { cap: true })).toMatchObject({ n: CAP })
      expect([breakerState(), capBreakerState()]).toEqual(['closed', 'open'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a cap fallback is never cached, answer or over-cap marker: the next request checks again', async () => {
    const zero = denseRows(4500).map(r => ({ ...r, q: 0, cat: 0, flags: 0 }))
    answer = tableAnswer(zero)
    expect(await getPois(plan, Q, { cap: true })).toMatchObject({ capFallback: 'features', cached: false })
    expect(await getPois(plan, Q, { cap: true })).toMatchObject({ capFallback: 'features', cached: false })
    expect(lruUsage().entries).toBe(0)
    // too dense for today's path too (over SCAN_ROWS): still no over-cap marker from a fallback
    answer = tableAnswer(denseRows(SCAN_ROWS + 1).map(r => ({ ...r, q: 0, cat: 0, flags: 0 })))
    expect(await getPois(plan, 'big', { cap: true })).toBeNull()
    expect(lruUsage().entries).toBe(0)
  })

  it('shadow (shadowPois) never takes the pool, the admission slot, the LRU or the shared breaker', async () => {
    const { shadowPois } = await import('../../../api/lib/poiQuery.js')
    const OUT = '[out:json][timeout:20][bbox:48.8,2.3,48.9,2.4];nw["amenity"="cafe"];out tags center;'
    await getPois(parseQuery(OUT), OUT) // coverage loaded
    answer = tableAnswer(denseRows(4500))
    poolQuery.mockClear()
    // a shadow that hangs mid-run...
    let release
    shadowQuery.mockImplementationOnce(opts => (opts.sql.includes('ix_rank') ? new Promise(r => { release = () => r([[]]) }) : answerSql(opts)))
    const shadow = shadowPois(plan, Q)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    // ...leaves served traffic exactly as it was: admitted at once, on the pool
    expect(await getPois(plan, 'served-while-shadow', { cap: false })).toMatchObject({ n: 4500 })
    await expect(shadowPois(plan, 'other')).resolves.toBeNull() // one shadow at a time
    release()
    await shadow
    expect(poolQuery.mock.calls.some(c => c[0].sql.includes('ix_rank'))).toBe(false)
    expect(lruUsage().entries).toBe(1) // only the served answer
    // and a served query in flight means no shadow starts
    let hold
    answer = () => new Promise(r => { hold = () => r(denseRows(10)) })
    const served = getPois(plan, 'slow-served', { cap: false })
    await vi.waitFor(() => expect(hold).toBeTypeOf('function'))
    expect(await shadowPois(plan, 'while-served')).toBeNull()
    hold()
    await served
    expect([breakerState(), capBreakerState()]).toEqual(['closed', 'closed'])
  })

  it('shadow never moves the cap breaker: slow or failing shadow runs (own cold connection) leave serving capped', async () => {
    const { shadowPois } = await import('../../../api/lib/poiQuery.js')
    const rows = denseRows(4500)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      // 3 s capped shadow runs, then failing ones: neither may switch the cap off for users
      shadowQuery.mockImplementation((opts, params) => {
        if (opts.sql.includes('q, cat, flags FROM')) vi.setSystemTime(Date.now() + 3000)
        return runSql({ sql: opts.sql, params }, rows)
      })
      for (let i = 0; i < 3; i++) await shadowPois(plan, `slow-shadow${i}`)
      expect(capBreakerState()).toBe('closed')
      shadowQuery.mockImplementation((opts, params) => {
        if (opts.sql.includes('q, cat, flags FROM')) throw Object.assign(new Error('Query execution was interrupted'), { errno: 3024 })
        return runSql({ sql: opts.sql, params }, rows)
      })
      for (let i = 0; i < 3; i++) await shadowPois(plan, `failing-shadow${i}`)
      expect(capBreakerState()).toBe('closed')
    } finally {
      vi.useRealTimers()
      shadowQuery.mockImplementation(answerSql)
    }
  })

  it('shadow backs off 60 s after a failed connect (e.g. ER_CON_COUNT_ERROR), and never retries a connect inside a run', async () => {
    const { shadowPois } = await import('../../../api/lib/poiQuery.js')
    const OUT = '[out:json][timeout:20][bbox:48.8,2.3,48.9,2.4];nw["amenity"="cafe"];out tags center;'
    await getPois(parseQuery(OUT), OUT) // coverage loaded
    answer = tableAnswer(denseRows(10))
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      dedicatedConnection.mockClear()
      dedicatedConnection.mockRejectedValueOnce(Object.assign(new Error('Too many connections'), { code: 'ER_CON_COUNT_ERROR', errno: 1040 }))
      expect(await shadowPois(plan, 'a')).toBeNull()
      expect(dedicatedConnection).toHaveBeenCalledTimes(1) // no retry inside the run
      vi.setSystemTime(Date.now() + 59_000)
      expect(await shadowPois(plan, 'b')).toBeNull() // another tile, within 60 s: no connection at all
      expect(dedicatedConnection).toHaveBeenCalledTimes(1)
      vi.setSystemTime(Date.now() + 2_000)
      expect(await shadowPois(plan, 'c')).toMatchObject({ n: 10 }) // after the backoff: shadow again
      expect(dedicatedConnection).toHaveBeenCalledTimes(2)
      expect(breakerState()).toBe('closed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('features zero or stale (under half the candidates deck-eligible): today\'s path, logged, never a thin capped deck', async () => {
    const rows = denseRows(4500).map(r => ({ ...r, q: 0, cat: 0, flags: 0 })) // an older loader's rows
    answer = tableAnswer(rows)
    const out = await getPois(plan, Q, { cap: true })
    expect(out).toMatchObject({ n: 4500, capFallback: 'features', cached: false })
    expect(out.scanned).toBeUndefined()
    expect(statements().some(q => q.includes('uq_osm'))).toBe(false)
    expect(console.warn).toHaveBeenCalledWith(JSON.stringify({ evt: 'poi_cap_fallback', reason: 'features', scanned: 4500, eligible: 0 }))
    expect(capBreakerState()).toBe('closed')
  })

  it('reads features_version from gate_report, a query that works before and after the phase12 migration', async () => {
    answer = tableAnswer(denseRows(10))
    await getPois(plan, Q)
    const sql = poolQuery.mock.calls.find(c => c[0].sql.includes('poi_builds'))[0].sql
    expect(sql).toContain("JSON_EXTRACT(gate_report, '$.features_version') AS features_version")
    expect(sql).not.toMatch(/\b(q|cat|flags)\b/)
    expect(POI_SCHEMA_VERSION).toBe(1) // unchanged: old code keeps serving new builds, new code old ones
  })
})

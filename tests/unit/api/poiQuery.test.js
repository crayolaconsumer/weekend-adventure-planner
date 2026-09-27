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

// Fake pool: poi_builds answers from `build`, everything else from `answer`
let build
let answer
const poolQuery = vi.fn(async (opts, params) => {
  if (opts.sql.includes('poi_builds')) {
    if (build instanceof Error) throw build
    return [build ? [build] : []]
  }
  // Single-group tests may leave out the UNION's group column
  return [(await answer(opts, params)).map(r => ({ g: 0, ...r }))]
})
vi.mock('../../../api/lib/db.js', () => ({ getPool: () => ({ query: poolQuery }) }))

const {
  parseQuery, buildSql, queryPois, getPois, isCovered, breakerState,
  _resetPoiState, POI_SCHEMA_VERSION, SCAN_ROWS, MAX_BODY_BYTES
} = await import('../../../api/lib/poiQuery.js')
const { lookupPlace } = await import('../../../api/lib/placeLookup.js')
const { parseOverpassResponse, fetchPlaceById } = await import('../../../src/utils/apiClient.js')

const cellsOf = (s, w, n, e) => cellRanges(s, w, n, e).flatMap(([lo, hi]) => Array.from({ length: hi - lo + 1 }, (_, k) => lo + k))
const GB = cellsOf(49.9, -8, 60.9, 1.8)

// Runs the generated SQL against rows in memory: every `?` becomes its bound
// value, then each UNION part's WHERE is evaluated per row, ordered and
// limited like MySQL would (our SQL uses only these forms)
function runSql({ sql, params }, rows) {
  let i = 0
  return sql.replace(/\?/g, () => `p[${i++}]`).split(' UNION ALL ').flatMap(part => {
    const m = /^\(SELECT (?:\/\*.*?\*\/ )?(\d+) AS g, osm_type, osm_id, el FROM \w+ WHERE (.*) ORDER BY osm_type, osm_id LIMIT p\[(\d+)\]\)/.exec(part)
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
      .slice(0, params[m[3]])
      .map(r => ({ ...r, g: Number(m[1]) }))
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
    el: JSON.stringify(el)
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
    expect(amenity.types).toEqual([1, 2])
    expect(amenity.keys.amenity).toContain('restaurant')
    expect(amenity.name).toBe(true) // >50 km adds ["name"]
    expect(shop.keys.shop).toContain('bakery')
    expect(plan.bbox.s).toBeLessThan(plan.bbox.n)
    const m = q.match(/\[bbox:([^\]]+)\]/)[1].split(',').map(Number)
    expect(plan.bbox).toEqual({ s: m[0], w: m[1], n: m[2], e: m[3] })
  })

  it('parses town page queries into 8 limited statements', () => {
    for (const [lat, lng] of CENTRES) {
      const plan = parseQuery(townOverpassQuery(lat, lng))
      expect(plan).not.toBeNull()
      expect(plan.groups.map(g => g.limit)).toEqual([150, 100, 60, 40, 120, 100, 40, 150])
      expect(plan.groups[0].statements[0]).toMatchObject({ types: [1, 2, 3], name: true, wikidata: true })
      expect(plan.groups[3].statements[0].keys).toEqual({ amenity: ['place_of_worship'] })
    }
  })

  it('parses every typed id lookup; bare-number unions take the old path', async () => {
    const queries = await idQueries()
    expect(queries).toHaveLength(8)
    const typed = [0, 1, 2, 4, 5, 6].map(i => queries[i])
    for (const q of typed) {
      const plan = parseQuery(q)
      expect(plan, q).not.toBeNull()
      expect(plan.kind).toBe('id')
    }
    expect(parseQuery(queries[0]).groups[0].statements).toEqual([{ type: 1, id: 123 }])
    // (node(N);way(N);): if the DB only held the way, it would win over a real
    // node outside the build, so these never use the DB
    expect(parseQuery(queries[3])).toBeNull()
    expect(parseQuery(queries[7])).toBeNull()
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
      '(SELECT /*+ MAX_EXECUTION_TIME(800) */ 0 AS g, osm_type, osm_id, el FROM pois WHERE (' +
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
    expect(parts).toHaveLength(8)
    expect(sql.match(/MAX_EXECUTION_TIME/g)).toHaveLength(1)
    expect(parts[0]).toMatch(/^\(SELECT \/\*\+ MAX_EXECUTION_TIME\(800\) \*\/ 0 AS g,/)
    expect(parts[7]).toMatch(/^\(SELECT 7 AS g,.* LIMIT \?\) ORDER BY g, osm_type, osm_id$/)
    // ["name"] needs the name tag itself; has_name also counts name:en-only rows
    expect(parts[0]).toMatch(/has_name_tag = 1 AND has_wikidata = 1\)\) ORDER BY osm_type, osm_id LIMIT \?\)$/)

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
  const poiCalls = () => poolQuery.mock.calls.filter(c => !c[0].sql.includes('poi_builds')).length
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
    build = { build_id: 'uk-20260927T0215Z', schema_version: POI_SCHEMA_VERSION, osm_timestamp: new Date('2026-09-27T02:15:00Z'), coverage: JSON.stringify(GB) }
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
    answer = () => new Promise(resolve => { release = () => resolve([ROW]) })
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
    answer = async () => Array.from({ length: SCAN_ROWS + 1 }, (_, i) => ({ ...ROW, osm_id: i }))
    expect(await getPois(plan, Q)).toBeNull()
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
    answer = async () => Array.from({ length: SCAN_ROWS + 1 }, (_, i) => ({ ...ROW, osm_id: i }))
    await getPois(plan, Q)
    expect(await getPois(plan, Q)).toBeNull()
    expect(await getPois(plan, Q, { useLru: false })).toBeNull() // shadow too
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
    answer = () => new Promise(resolve => { release = () => resolve([ROW]) })
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

  it('does not keep bodies over 1 MB (in bytes) in the LRU, and shadow calls skip it', async () => {
    const big = { ...ROW, el: JSON.stringify({ type: 'node', id: 5, lat: 51.5, lon: -0.1, tags: { name: '\u6771'.repeat(400_000), amenity: 'cafe' } }) }
    answer = async () => [big]
    await getPois(plan, 'big')
    expect(await getPois(plan, 'big')).toMatchObject({ cached: false })
    answer = async () => [ROW]
    await getPois(plan, 'shadow', { useLru: false })
    expect(await getPois(plan, 'shadow')).toMatchObject({ cached: false })
    expect(poiCalls()).toBe(4)
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
    answer = () => new Promise(resolve => { release = () => resolve([ROW]) })
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

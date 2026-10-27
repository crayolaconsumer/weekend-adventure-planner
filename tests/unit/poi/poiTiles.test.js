import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Buffer } from 'node:buffer'
import { join } from 'node:path'
import { poiCell, isLarge, LARGE_CELL, OSM_TYPE_CODE } from '../../../shared/poiCell.mjs'
import { poiFeatures, CAP, ELIGIBLE, rankCap } from '../../../shared/poiRank.mjs'
import { blockOf, cellOf, encodeBlock, decodeHeader, decodeHeaderPack, encodeHeaderPack, decodeRows, encodeRows, HEADER_BYTES, ID_HEADER_BYTES, CELLS } from '../../../shared/poiTiles.mjs'
import { brotliCompressSync } from 'node:zlib'
import { buildDiscoverOverpassQuery } from '../../../shared/overpassQuery.js'
import { snapQueryBbox, SNAP_GRID_DEGREES } from '../../../api/lib/bboxSnap.js'

// The DB path's own SQL, executed in JS: the oracle every tile answer is compared with
const table = vi.hoisted(() => ({ rows: [], build: 'uk-test' }))
vi.mock('../../../api/lib/kvCache.js', () => ({
  cacheGet: async () => null, cacheSet: async () => true, hashKey: v => v, isCacheEnabled: () => false, getClient: () => null,
}))
vi.mock('../../../api/lib/db.js', () => {
  const run = (sql, params) => [execSql(sql, params, table.rows, table.build)]
  const conn = { query: async (o, p) => run(o.sql ?? o, p), destroy: () => {}, end: async () => {} }
  return { runQuery: async (sql, params) => run(sql, params), getFreshConnection: async () => conn, releaseConnection: () => {}, dedicatedConnection: async () => conn }
})

/**
 * Evaluates the statements poiQuery.js builds (buildSql, buildProbeSql, buildCandidateSql,
 * buildElSql, TABLE_BUILD_SQL) over in-memory rows by translating the WHERE into JS.
 * Only that grammar; anything else throws, so a new SQL shape fails loudly.
 */
function execSql(sql, params, rows, build) {
  if (/^(SET SESSION|START TRANSACTION|ROLLBACK)/.test(sql)) return []
  if (sql.includes('information_schema.tables')) return [{ owner: build }]
  let i = 0
  const text = sql.replace(/\?/g, () => JSON.stringify(params[i++]))
  if (i !== params.length) throw new Error('param count')
  const union = text.startsWith('(')
  const selects = union ? text.replace(/ ORDER BY g, osm_type, osm_id$/, '').slice(1, -1).split(') UNION ALL (') : [text]
  const out = []
  for (const sel of selects) {
    const m = /^SELECT (?:\/\*\+[^*]*\*\/ )?(.*?) FROM pois(?: FORCE INDEX \(\w+\))? WHERE (.*?)( ORDER BY osm_type, osm_id)?(?: LIMIT (\d+))?$/.exec(sel)
    if (!m) throw new Error(`unknown SQL: ${sel}`)
    const where = m[2]
      .replace(/cell BETWEEN (\d+) AND (\d+)/g, '(r.cell >= $1 && r.cell <= $2)')
      .replace(/(\w+)(?: COLLATE utf8mb4_0900_bin)? IN \(([^)]*)\)/g, '[$2].includes(r.$1)')
      .replace(/(?<![.\w])(\w+) (>=|<=) /g, 'r.$1 $2 ')
      .replace(/(\w+) = ([\d.-]+)/g, 'r.$1 === $2')
      .replace(/ AND /g, ' && ').replace(/ OR /g, ' || ')
    if (/[a-z_]+ (=|IN|BETWEEN|COLLATE)\b/.test(where)) throw new Error(`untranslated: ${where}`)
    const pred = new Function('r', `return ${where}`)
    let hits = rows.filter(r => pred(r))
    // Without ORDER BY the order is the server's: reverse it, so nothing relies on it
    hits = m[3] ? hits.sort((a, b) => a.osm_type - b.osm_type || a.osm_id - b.osm_id) : hits.reverse()
    if (m[4]) hits = hits.slice(0, Number(m[4]))
    const g = /^(\d+) AS g/.exec(m[1])
    out.push(...hits.map(r => (g ? { ...r, g: Number(g[1]) } : { ...r })))
  }
  return union ? out.sort((a, b) => a.g - b.g || a.osm_type - b.osm_type || a.osm_id - b.osm_id) : out
}

const { parseQuery, queryPois } = await import('../../../api/lib/poiQuery.js')
const { answerFromRows, getTilePois, statementPredicate, boundsPredicate, headerCacheGet, headerCacheSet, headerCacheSize,
  HEADER_LRU_MAX, _resetTileState } = await import('../../../api/lib/poiTiles.js')
const { localStore, r2Store } = await import('../../../api/lib/poiStore.js')
const { groupRows, writeTiles } = await import('../../../scripts/poi/tiles.mjs')

const r7 = x => Math.round(x * 1e7) / 1e7

/** A pois row exactly as build.mjs makes one (cell, LARGE bucket, k_*, has_*, features, el). */
function row({ type = 'node', id, lat, lon, span = 0, tags }) {
  const el = type === 'node'
    ? { type, id, lat: r7(lat), lon: r7(lon), tags }
    : { type, id, center: { lat: r7(lat), lon: r7(lon) }, bounds: { minlat: r7(lat - span), minlon: r7(lon - span), maxlat: r7(lat + span), maxlon: r7(lon + span) }, tags }
  const b = el.bounds || { minlat: el.lat, minlon: el.lon, maxlat: el.lat, maxlon: el.lon }
  const r = { cell: poiCell(r7(lat), r7(lon)), osm_type: OSM_TYPE_CODE[type], osm_id: id, lat: r7(lat), lon: r7(lon),
    min_lat: b.minlat, min_lon: b.minlon, max_lat: b.maxlat, max_lon: b.maxlon }
  if (isLarge(r)) r.cell = LARGE_CELL
  for (const k of ['amenity', 'tourism', 'leisure', 'historic', 'shop', 'natural', 'man_made']) r[`k_${k}`] = typeof tags[k] === 'string' && tags[k].length <= 48 ? tags[k] : null
  Object.assign(r, { has_name: 1, has_name_tag: tags.name ? 1 : 0, has_wikidata: tags.wikidata ? 1 : 0, ...poiFeatures(el), el: JSON.stringify(el) })
  return r
}

// Deterministic PRNG
function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}
const VALUES = { amenity: ['cafe', 'pub', 'restaurant', 'cafe ', 'Cafe', 'bank', 'theatre', 'library'], tourism: ['museum', 'attraction', 'viewpoint', 'hotel'],
  leisure: ['park', 'nature_reserve', 'garden'], historic: ['castle', 'ruins', 'memorial'], shop: ['bakery', 'books', 'supermarket'], natural: ['beach', 'peak', 'wood'] }

/** Rows scattered over a box, with elements straddling every edge and some huge ones. */
function scatter(n, { s, w, nn, e }, seed = 1) {
  const rand = rng(seed)
  const rows = []
  const pick = a => a[Math.floor(rand() * a.length)]
  for (let i = 0; i < n; i++) {
    const tags = { [pick(Object.keys(VALUES))]: null }
    for (const k of Object.keys(tags)) tags[k] = pick(VALUES[k])
    if (rand() < 0.3) tags[pick(Object.keys(VALUES))] = pick(VALUES[pick(Object.keys(VALUES))])
    if (rand() < 0.85) tags.name = `Place ${i}`
    else tags['name:en'] = `Place ${i}`
    if (rand() < 0.2) tags.wikidata = `Q${i}`
    if (rand() < 0.5) tags.opening_hours = 'Mo-Su 09:00-17:00'
    const type = pick(['node', 'node', 'way', 'relation'])
    rows.push(row({ type, id: 1000 + i, lat: s + rand() * (nn - s), lon: w + rand() * (e - w), span: type === 'node' ? 0 : rand() < 0.03 ? 0.6 : rand() * 0.15, tags }))
  }
  return rows
}

const discover = (lat, lng, radius, cat) => snapQueryBbox(buildDiscoverOverpassQuery(lat, lng, radius, cat).query)
const box = (s, w, n, e, body) => `[out:json][timeout:20][bbox:${s},${w},${n},${e}];${body}`

// Every query shape parseQuery answers over a bbox
const SHAPES = (s, w, n, e) => ({
  'discover union (nwr, no name)': box(s, w, n, e, '(nwr["amenity"~"^(cafe|pub|restaurant)$"];nwr["tourism"~"^(museum|attraction)$"];nwr["leisure"="park"];);out tags center;'),
  'name filter': box(s, w, n, e, '(nw["amenity"~"^(cafe|pub)$"]["name"];nw["historic"~"^(castle|ruins)$"]["name"];);out center;'),
  'wikidata + two keys': box(s, w, n, e, 'nwr["amenity"="theatre"]["tourism"="attraction"]["wikidata"];out center;'),
  'node only': box(s, w, n, e, 'node["natural"~"^(peak|beach)$"];out body center;'),
  'way only, limit': box(s, w, n, e, 'way["leisure"~"^(park|nature_reserve|garden)$"]["name"];out tags bb 7;'),
  'relation only': box(s, w, n, e, 'relation["leisure"="nature_reserve"];out center;'),
  'two output groups (rows in both)': box(s, w, n, e, 'nwr["amenity"="cafe"];out tags bb 5;nwr["amenity"~"^(cafe|pub)$"]["name"];out center;'),
})

describe('block format', () => {
  it('blockOf/cellOf round-trip every cell of a block, row-major inside it', () => {
    const c0 = poiCell(51.05, -0.95)
    const { block } = blockOf(c0)
    const seen = new Set()
    for (let idx = 0; idx < CELLS; idx++) {
      const c = cellOf(block, idx)
      expect(blockOf(c)).toEqual({ block, idx })
      seen.add(c)
    }
    expect(seen.size).toBe(100)
    // neighbouring 0.1-degree cells across a block edge land in different blocks
    expect(blockOf(poiCell(51.95, -1.05)).block).not.toBe(blockOf(poiCell(51.95, -0.95)).block)
    expect(blockOf(poiCell(51.95, -0.95)).block).not.toBe(blockOf(poiCell(52.05, -0.95)).block)
  })

  it('encodes and decodes a block: header offsets, coverage bits, rows verbatim and in (type, id) order', () => {
    const rows = scatter(300, { s: 51, w: -1, nn: 52, e: 0 }, 7).filter(r => r.cell !== LARGE_CELL)
    const cells = new Map()
    for (const r of rows) {
      const { block, idx } = blockOf(r.cell)
      expect(block).toBe(blockOf(rows[0].cell).block)
      if (!cells.has(idx)) cells.set(idx, [])
      cells.get(idx).push(r)
    }
    const covered = [0, 7, 8, 63, 99]
    const block = blockOf(rows[0].cell).block
    const buf = encodeBlock(block, cells, covered)
    const h = decodeHeader(buf.subarray(0, HEADER_BYTES))
    expect(h.block).toBe(block)
    expect([...h.covered].flatMap((b, i) => (b ? [i] : []))).toEqual(covered)
    let expectOffset = 0
    for (let idx = 0; idx < CELLS; idx++) {
      const { offset, length } = h.cells[idx]
      expect(offset).toBe(expectOffset)
      expectOffset += length
      const want = (cells.get(idx) || []).slice().sort((a, b) => a.osm_type - b.osm_type || a.osm_id - b.osm_id)
      const got = decodeRows(buf.subarray(HEADER_BYTES + offset, HEADER_BYTES + offset + length))
      expect(got.length).toBe(want.length)
      got.forEach((g, k) => {
        const { cell: _c, lat: _a, lon: _o, has_name: _h, ...w } = want[k]
        expect(g).toEqual(w)
      })
    }
    expect(buf.length).toBe(HEADER_BYTES + expectOffset)
  })

  it('rejects a bad header', () => {
    expect(() => decodeHeader(Buffer.alloc(HEADER_BYTES))).toThrow(/not a POI block/)
    const b = encodeBlock(1, new Map())
    b.writeUInt8(9, 4)
    expect(() => decodeHeader(b)).toThrow(/version 9/)
    expect(decodeRows(Buffer.alloc(0))).toEqual([])
    expect(decodeRows(encodeRows([]))).toEqual([]) // a build with no LARGE_CELL rows
  })

  it('keeps el byte-exact, unicode and escapes included', () => {
    const r = row({ id: 5, lat: 51.5, lon: -0.1, tags: { amenity: 'cafe', name: 'Café "Tab\there"\nnewline ☕' } })
    const [back] = decodeRows(encodeRows([r]))
    expect(back.el).toBe(r.el)
  })
})

describe('predicate parity with the SQL (poiQuery buildSql executed as the oracle)', () => {
  // London-ish box straddling the 0 meridian and the 51/52 block edges
  const [s, w, n, e] = [51.42, -0.31, 51.63, 0.12]
  const rows = scatter(4000, { s: s - 0.5, w: w - 0.5, nn: n + 0.5, e: e + 0.5 }, 42)
  // exactly on each edge: bounds touching the box count (>= / <=), a hair outside doesn't
  let id = 900000
  for (const [lat, lon] of [[s, -0.1], [n, -0.1], [51.5, w], [51.5, e], [s - 1e-7, -0.1], [n + 1e-7, -0.1], [51.5, w - 1e-7], [51.5, e + 1e-7]]) {
    rows.push(row({ id: id++, lat, lon, tags: { amenity: 'cafe', name: 'edge' } }))
  }
  // ways centred outside the box whose bounds reach in, and one reaching only to the edge
  rows.push(row({ type: 'way', id: id++, lat: n + 0.15, lon: 0, span: 0.15, tags: { leisure: 'park', name: 'reach' } }))
  rows.push(row({ type: 'way', id: id++, lat: s - 0.1999, lon: 0, span: 0.1999, tags: { leisure: 'park', name: 'touch' } }))
  rows.push(row({ type: 'relation', id: id++, lat: 53, lon: 0, span: 2, tags: { leisure: 'nature_reserve', name: 'huge' } }))

  beforeEach(() => { table.rows = rows })

  for (const [name, ql] of Object.entries(SHAPES(s, w, n, e))) {
    it(`${name}: same body as the DB path`, async () => {
      const plan = parseQuery(ql)
      expect(plan).not.toBeNull()
      const db = await queryPois(plan, { osmTimestamp: '2026-10-25T21:21:21Z' })
      const tiles = answerFromRows(plan, rows, { osmTimestamp: '2026-10-25T21:21:21Z' })
      expect(db.truncated).toBeUndefined()
      expect(tiles.body).toBe(db.body)
      expect(tiles.ids).toEqual(db.ids)
    })
  }

  it('the fixture exercises what it claims (edges in, hair outside out, huge relation in, cafe != "cafe ")', () => {
    const plan = parseQuery(box(s, w, n, e, 'nwr["amenity"="cafe"];out center;'))
    const ids = answerFromRows(plan, rows, {}).ids
    expect(ids.filter(x => /^node\/90000[0-7]$/.test(x)).sort()).toEqual(['node/900000', 'node/900001', 'node/900002', 'node/900003'])
    const all = answerFromRows(parseQuery(box(s, w, n, e, '(nwr["leisure"~"^(park|nature_reserve)$"];);out center;')), rows, {}).ids
    expect(all).toEqual(expect.arrayContaining(['way/900008', 'way/900009', 'relation/900010']))
    expect(rows.some(r => r.k_amenity === 'cafe ')).toBe(true)
    expect(answerFromRows(plan, rows, {}).n).toBe(rows.filter(r => r.k_amenity === 'cafe' && boundsPredicate({ s, w, n, e })(r)).length)
  })

  it('statementPredicate: types, every key, exact values, name and wikidata flags', () => {
    const r = { osm_type: 2, k_amenity: 'cafe', k_tourism: 'attraction', has_name_tag: 1, has_wikidata: 0 }
    const p = st => statementPredicate({ types: [1, 2, 3], keys: {}, name: false, wikidata: false, ...st })(r)
    expect(p({ keys: { amenity: ['cafe'] } })).toBe(true)
    expect(p({ keys: { amenity: ['cafe'] }, types: [1] })).toBe(false)
    expect(p({ keys: { amenity: ['cafe'], tourism: ['museum'] } })).toBe(false)
    expect(p({ keys: { amenity: ['Cafe'] } })).toBe(false)
    expect(p({ keys: { amenity: ['cafe'] }, name: true })).toBe(true)
    expect(p({ keys: { amenity: ['cafe'] }, wikidata: true })).toBe(false)
    expect(p({ keys: { shop: ['books'] } })).toBe(false) // k_shop undefined/null never matches
  })

  it('a group over SCAN_ROWS is truncated, as the DB path', async () => {
    const many = Array.from({ length: 12001 }, (_, i) => row({ id: i + 1, lat: 51.5, lon: -0.1 + i * 1e-6, tags: { amenity: 'cafe', name: 'x' } }))
    table.rows = many
    const plan = parseQuery(box(s, w, n, e, 'nwr["amenity"="cafe"];out center;'))
    expect((await queryPois(plan, {})).truncated).toBe(true)
    expect(answerFromRows(plan, many, {}).truncated).toBe(true)
  })
})

describe('relevance cap parity', () => {
  const q = discover(51.5074, -0.1278, 10000, null)
  const plan = parseQuery(q)
  const { s, w, n, e } = plan.bbox
  const dense = scatter(5000, { s, w, nn: n, e }, 3).map(r => ({ ...r, k_amenity: 'cafe', el: r.el.replace(/"tags":\{/, '"tags":{"amenity":"cafe",') }))
    .map(r => ({ ...r, ...poiFeatures(JSON.parse(r.el)) }))

  it('over CAP: the capped DB transaction and the tiles pick the same rows, same body', async () => {
    table.rows = dense
    const db = await queryPois(plan, { features: true, buildId: table.build, osmTimestamp: 't' })
    const tiles = answerFromRows(plan, dense, { capOn: true, osmTimestamp: 't' })
    expect(db.capPath).toBe(true)
    expect(db.n).toBe(CAP)
    expect(tiles.capPath).toBe(true)
    expect(tiles.body).toBe(db.body)
    expect(tiles.scanned).toBe(db.scanned)
  })

  it('cap off, or not rankable, serves the uncapped answer', () => {
    expect(answerFromRows(plan, dense, { capOn: false }).n).toBeGreaterThan(CAP)
    const big = parseQuery(discover(51.5074, -0.1278, 40000, null))
    expect(answerFromRows(big, dense, { capOn: true }).capPath).toBeUndefined()
  })

  it('too few deck-eligible candidates: uncapped fallback, flagged', async () => {
    const thin = dense.map(r => ({ ...r, flags: r.flags & ~ELIGIBLE }))
    table.rows = thin
    const db = await queryPois(plan, { features: true, buildId: table.build, osmTimestamp: 't' })
    const tiles = answerFromRows(plan, thin, { capOn: true, osmTimestamp: 't' })
    expect(tiles.capFallback).toBe('features')
    expect(db.capFallback).toBe('features')
    expect(tiles.body).toBe(db.body)
  })

  it('more than RANK_SCAN_ROWS candidates: too dense even to rank, truncated (null upstream)', () => {
    const huge = Array.from({ length: 60001 }, (_, i) => ({ ...dense[i % dense.length], osm_id: i + 1 }))
    expect(answerFromRows(plan, huge, { capOn: true }).truncated).toBe(true)
    expect(answerFromRows(plan, huge.slice(0, 60000), { capOn: true }).capPath).toBe(true)
  })

  it('only a build carrying this code\'s FEATURES_VERSION is capped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'poi-tiles-fv-'))
    try {
      const cov = []
      for (let lat = 51.35; lat < 51.7; lat += 0.1) for (let lon = -0.35; lon < 0.1; lon += 0.1) cov.push(poiCell(lat, lon))
      const metaOf = fv => ({ build_id: `uk-fv${fv}`, schema_version: 1, features_version: fv, osm_timestamp: 't', row_count: dense.length })
      for (const fv of [2, 1]) {
        _resetTileState()
        writeTiles(groupRows(dense, cov), metaOf(fv), dir)
        const r = await getTilePois(plan, q, { store: localStore(dir), cap: true })
        expect(r.capPath).toBe(fv === 2 ? true : undefined)
        expect(r.n > CAP).toBe(fv !== 2)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30000) // encodes the dense fixture twice at brotli 11: ~4 s alone, more on a loaded machine

  it('matches rankCap called directly on (type, id)-ordered candidates', () => {
    const sorted = dense.filter(boundsPredicate(plan.bbox)).sort((a, b) => a.osm_type - b.osm_type || a.osm_id - b.osm_id)
    const want = rankCap(sorted, { lat: (s + n) / 2, lng: (w + e) / 2 }, CAP, SNAP_GRID_DEGREES / 2).map(r => `${['', 'node', 'way', 'relation'][r.osm_type]}/${r.osm_id}`)
    expect(answerFromRows(plan, dense, { capOn: true }).ids).toEqual(want)
  })
})

describe('getTilePois over a block store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'poi-tiles-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  // Four blocks around (52, -1), plus LARGE rows; coverage: all of it except one cell
  const rows = scatter(6000, { s: 51.3, w: -1.7, nn: 52.7, e: -0.3 }, 11)
  const coverageCells = []
  for (let lat = 51.05; lat < 53; lat += 0.1) for (let lon = -1.95; lon < 0; lon += 0.1) coverageCells.push(poiCell(lat, lon))
  const hole = poiCell(52.55, -0.45)
  const meta = { build_id: 'uk-test', schema_version: 1, features_version: 2, osm_timestamp: '2026-10-25T21:21:21.000Z', row_count: rows.length }
  const { stats } = writeTiles(groupRows(rows, coverageCells.filter(c => c !== hole)), meta, dir)
  const base = localStore(dir)
  const calls = { get: 0, range: 0 }
  const store = { get: k => { calls.get++; return base.get(k) }, getRange: (k, a, b) => { calls.range++; return base.getRange(k, a, b) } }
  beforeEach(() => { _resetTileState(); table.rows = rows; calls.get = 0; calls.range = 0 })
  // A manifest as built before headers were embedded (or edited): manifests pass through `edit`
  const withManifest = edit => ({
    get: async k => {
      calls.get++
      const buf = await base.get(k)
      return k.startsWith('manifests/') ? Buffer.from(JSON.stringify(edit(JSON.parse(buf)))) : buf
    },
    getRange: (k, a, b) => { calls.range++; return base.getRange(k, a, b) },
  })
  const legacy = withManifest(m => { delete m.header_pack; return m })

  it('writes every row once', () => {
    expect(stats.rows).toBe(rows.length)
    expect(rows.some(r => r.cell === LARGE_CELL)).toBe(true)
  })

  for (const [name, ql] of Object.entries(SHAPES(51.85, -1.2, 52.15, -0.8))) {
    it(`${name}, box across four blocks: same body as the DB path`, async () => {
      const plan = parseQuery(ql)
      const trace = {}
      const tiles = await getTilePois(plan, ql, { store, trace })
      const db = await queryPois(plan, { osmTimestamp: '2026-10-25T21:21:21Z' })
      expect(trace.blocks).toBe(4)
      expect(tiles.body).toBe(db.body)
      expect(tiles.buildId).toBe('uk-test')
      expect(tiles.bytesRead).toBeGreaterThan(0)
    })
  }

  it('the manifest packs every block header and the id-index header, byte for byte', async () => {
    const m = JSON.parse(await base.get('manifests/uk-test.json'))
    const pack = decodeHeaderPack(m.header_pack)
    const want = await Promise.all(Object.entries(m.blocks).map(([b, sha]) => base.getRange(`b/${b}.${sha}.bin`, 0, HEADER_BYTES - 1)))
    expect(pack.blocks.map(b => b.header.toString('hex')).sort()).toEqual(want.map(b => b.toString('hex')).sort())
    expect(Object.fromEntries(pack.blocks.map(b => [decodeHeader(b.header).block, b.sha]))).toEqual(m.blocks)
    expect(pack.ids).toEqual(await base.getRange(`b/ids.${m.ids}.bin`, 0, ID_HEADER_BYTES - 1))
  })

  it('cold read: headers come with the manifest, so R2 serves the coalesced body ranges only', async () => {
    const ql = SHAPES(51.85, -1.2, 52.15, -0.8)['node only']
    const trace = {}
    await getTilePois(parseQuery(ql), ql, { store, trace })
    expect(trace.reads).toBe(4) // small fixture cells: every block's needed cells sit within RANGE_GAP_BYTES
    expect(calls.range).toBe(4) // 4 bodies, no header reads
  })

  it('a manifest without embedded headers: one header read per block, then cached', async () => {
    const ql = SHAPES(51.85, -1.2, 52.15, -0.8)['node only']
    const tiles = await getTilePois(parseQuery(ql), ql, { store: legacy })
    expect(calls.range).toBe(4 + 4) // 4 headers + 4 bodies
    calls.range = 0
    await getTilePois(parseQuery(ql), ql, { store: legacy })
    expect(calls.range).toBe(4)
    _resetTileState()
    expect((await getTilePois(parseQuery(ql), ql, { store })).body).toBe(tiles.body)
  })

  it('a packed header that is junk, missing, or carries another sha is skipped: those blocks read their own, same answer', async () => {
    const ql = SHAPES(51.85, -1.2, 52.15, -0.8)['node only']
    const want = (await getTilePois(parseQuery(ql), ql, { store })).body
    _resetTileState()
    calls.range = 0
    const broken = withManifest(m => {
      const { ids, blocks } = decodeHeaderPack(m.header_pack)
      // slot 0 repeats block 1 (block 0 has none), slot 2 is junk, slot 3 has a sha this manifest doesn't list
      return { ...m, header_pack: encodeHeaderPack(ids, [blocks[1], blocks[1], { sha: blocks[2].sha, header: Buffer.alloc(HEADER_BYTES, 7) }, { ...blocks[3], sha: 'deadbeef' }, ...blocks.slice(4)]) }
    })
    expect((await getTilePois(parseQuery(ql), ql, { store: broken })).body).toBe(want)
    expect(calls.range).toBe(4 + 3) // all four blocks are in the box: the three without a good header read it from R2
  })

  it('the DB build path (buildId) seeds from the pack too: cold, body ranges only', async () => {
    const ql = SHAPES(51.85, -1.2, 52.15, -0.8)['node only']
    await getTilePois(parseQuery(ql), ql, { store, buildId: 'uk-test' })
    expect(calls.get).toBe(2) // the build's manifest and LARGE; never current.json (that path makes 3)
    expect(calls.range).toBe(4)
  })

  it('a manifest is unpacked once, not per request (evicted headers then come from R2, not a re-seed)', async () => {
    const ql = SHAPES(51.85, -1.2, 52.15, -0.8)['node only']
    await getTilePois(parseQuery(ql), ql, { store })
    for (const k of [...Array(5000).keys()]) headerCacheSet(`filler${k}`, {}) // evict every seeded header
    calls.range = 0
    await getTilePois(parseQuery(ql), `${ql}again`, { store })
    expect(calls.range).toBe(4 + 4) // headers from R2: the pack was not unpacked a second time
  })

  it('a pack that does not decode is ignored as a whole (headers from R2), never thrown', async () => {
    const ql = SHAPES(51.85, -1.2, 52.15, -0.8)['node only']
    const junk = withManifest(m => ({ ...m, header_pack: 'bm90IGJyb3RsaQ==' }))
    expect((await getTilePois(parseQuery(ql), ql, { store: junk })).n).toBeGreaterThan(0)
    expect(calls.range).toBe(4 + 4)
    expect(() => decodeHeaderPack(Buffer.from(brotliCompressSync(Buffer.alloc(ID_HEADER_BYTES + 5))).toString('base64'))).toThrow(/bad header pack/)
  })

  it('cells more than RANGE_GAP_BYTES apart are read as separate ranges, and still decode right', async () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'poi-tiles-gap-'))
    try {
      const rand = rng(5)
      const noise = Array.from({ length: 150000 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rand() * 36)]).join('')
      const gapRows = [
        row({ id: 1, lat: 51.015, lon: -0.45, tags: { amenity: 'cafe', name: 'a' } }), // block cell 5 (needed)
        row({ id: 2, lat: 51.05, lon: -0.15, tags: { amenity: 'cafe', name: 'big', description: noise } }), // cell 8 (not needed): the gap
        row({ id: 3, lat: 51.115, lon: -0.45, tags: { amenity: 'cafe', name: 'b' } }), // cell 15 (needed)
      ]
      const cov = []
      for (let lat = 51.05; lat < 52; lat += 0.1) for (let lon = -0.95; lon < 0; lon += 0.1) cov.push(poiCell(lat, lon))
      writeTiles(groupRows(gapRows, cov), { ...meta, build_id: 'uk-gap' }, dir2)
      const ql = box(51.01, -0.46, 51.02, -0.44, 'nwr["amenity"="cafe"];out center;')
      const trace = {}
      const r = await getTilePois(parseQuery(ql), ql, { store: localStore(dir2), trace })
      expect(trace.reads).toBe(2)
      expect(trace.bytesRead).toBeLessThan(10000) // the 100 KB cell in between is never read
      table.rows = gapRows
      expect(r.body).toBe((await queryPois(parseQuery(ql), { osmTimestamp: '2026-10-25T21:21:21Z' })).body)
      expect(r.ids).toEqual(['node/1']) // node 3 is read (padding) and dropped by the bounds test, as in SQL
    } finally {
      rmSync(dir2, { recursive: true, force: true })
    }
  })

  it('an uncovered cell in the box, or a block outside the build: null (caller falls back)', async () => {
    const trace = {}
    const inHole = box(52.52, -0.48, 52.58, -0.42, 'nwr["amenity"="cafe"];out center;')
    expect(await getTilePois(parseQuery(inHole), inHole, { store, trace })).toBeNull()
    expect(trace.why).toBe('not_covered')
    const away = box(55.1, -3.2, 55.2, -3.1, 'nwr["amenity"="cafe"];out center;')
    expect(await getTilePois(parseQuery(away), away, { store, trace })).toBeNull()
    expect(trace.why).toBe('not_covered')
  })

  it('a padded scan reaching an uncovered block still answers (padding only adds rows)', async () => {
    // 52.75 is inside coverage; its padding reaches lat 52.95 (covered) and lon -0.05 (covered); block at lon 0 is absent
    const ql = box(52.6, -0.3, 52.75, -0.1, 'nwr["amenity"~"^(cafe|pub)$"];out center;')
    const tiles = await getTilePois(parseQuery(ql), ql, { store })
    const db = await queryPois(parseQuery(ql), { osmTimestamp: '2026-10-25T21:21:21Z' })
    expect(tiles.body).toBe(db.body)
  })

  it('read-size cap: a box needing more bytes than allowed is null, read nothing past the headers', async () => {
    const ql = SHAPES(51.85, -1.2, 52.15, -0.8)['discover union (nwr, no name)']
    const trace = {}
    expect(await getTilePois(parseQuery(ql), ql, { store, trace, maxReadBytes: 1000 })).toBeNull()
    expect(trace.why).toBe('read_cap')
    expect(calls.range).toBe(0) // the headers came with the manifest: nothing read from R2
    expect(await getTilePois(parseQuery(ql), ql, { store, maxReadBytes: trace.bytesRead })).not.toBeNull()
    _resetTileState()
    calls.range = 0
    expect(await getTilePois(parseQuery(ql), ql, { store: legacy, maxReadBytes: 1000 })).toBeNull()
    expect(calls.range).toBe(4) // without embedded headers: headers only
  })

  it('junk is not served here', async () => {
    const trace = {}
    expect(await getTilePois(null, 'k', { store, trace })).toBeNull()
    expect(trace.why).toBe('not_ours')
  })

  // Id lookups (lookupPlace's queries), through the id index: same body as the DB's uq_osm read
  const idQl = (type, id) => `[out:json][timeout:10];${type}(${id});out tags center;`
  const sample = t => rows.find(r => r.osm_type === t && r.cell !== LARGE_CELL)
  const idCases = () => [[1, sample(1)], [2, sample(2)], [3, sample(3)], [0, rows.find(r => r.cell === LARGE_CELL)]]
  for (const [i, name] of ['node', 'way', 'relation', 'LARGE relation or way'].entries()) {
    it(`id lookup, ${name}: the row, same body as the DB path`, async () => {
      const r = idCases()[i][1]
      const ql = idQl(['', 'node', 'way', 'relation'][r.osm_type], r.osm_id)
      const trace = {}
      const tiles = await getTilePois(parseQuery(ql), ql, { store, trace })
      const db = await queryPois(parseQuery(ql), { osmTimestamp: '2026-10-25T21:21:21Z' })
      expect(tiles.n).toBe(1)
      expect(tiles.body).toBe(db.body)
      expect(tiles.ids).toEqual([`${['', 'node', 'way', 'relation'][r.osm_type]}/${r.osm_id}`])
    })
  }

  it('id lookup: the index and block headers come with the manifest, so R2 serves shard + cell only', async () => {
    const r = sample(1)
    await getTilePois(parseQuery(idQl('node', r.osm_id)), 'k1', { store })
    expect(calls.range).toBe(2)
  })

  it('id lookup without embedded headers: index header once, then shard + block header + cell; cached after', async () => {
    const r = sample(1)
    const ql = idQl('node', r.osm_id)
    await getTilePois(parseQuery(ql), ql, { store: legacy })
    expect(calls.range).toBe(4) // id header, shard, block header, cell
    calls.range = 0
    const r2 = rows.find(x => x.osm_type === 1 && x.cell !== LARGE_CELL && blockOf(x.cell).block === blockOf(r.cell).block && x.osm_id !== r.osm_id)
    await getTilePois(parseQuery(idQl('node', r2.osm_id)), 'k2', { store: legacy })
    expect(calls.range).toBe(2) // shard + cell: both headers cached
  })

  it('id lookup of an id the build lacks (or the wrong type): an empty answer, as the DB gives', async () => {
    for (const ql of [idQl('node', 999999), idQl('way', sample(1).osm_id)]) {
      const tiles = await getTilePois(parseQuery(ql), ql, { store })
      const db = await queryPois(parseQuery(ql), { osmTimestamp: '2026-10-25T21:21:21Z' })
      expect(tiles.n).toBe(0)
      expect(tiles.body).toBe(db.body)
    }
  })

  it('a bare-number lookup (node-or-way pair: the node, as parseQuery plans it) matches the DB', async () => {
    const r = sample(1)
    const ql = `[out:json][timeout:10];(node(${r.osm_id});way(${r.osm_id}););out tags center;`
    const tiles = await getTilePois(parseQuery(ql), ql, { store })
    expect(tiles.body).toBe((await queryPois(parseQuery(ql), { osmTimestamp: '2026-10-25T21:21:21Z' })).body)
    expect(tiles.n).toBe(1)
  })

  it('a build without an id index (phase 1) declines id lookups: null, the DB answers', async () => {
    const old = { get: async k => {
      const buf = await base.get(k)
      if (!k.startsWith('manifests/')) return buf
      const m = JSON.parse(buf)
      delete m.ids
      return Buffer.from(JSON.stringify(m))
    }, getRange: base.getRange }
    const trace = {}
    expect(await getTilePois(parseQuery(idQl('node', sample(1).osm_id)), 'k', { store: old, trace })).toBeNull()
    expect(trace.why).toBe('no_ids')
  })

  it('a store error is null, never a throw', async () => {
    const broken = { get: base.get, getRange: async () => { throw new Error('boom') } }
    const ql = SHAPES(51.85, -1.2, 52.15, -0.8)['node only']
    const trace = {}
    expect(await getTilePois(parseQuery(ql), ql, { store: broken, trace })).toBeNull()
    expect(trace.why).toBe('error')
    expect(await getTilePois(parseQuery(ql), ql, { store: { get: async () => null, getRange: base.getRange }, trace })).toBeNull()
    expect(trace.why).toBe('no_build')
  })

  it('a truncated range read is an error, not a short answer', async () => {
    const short = { get: base.get, getRange: async (k, a, b) => (await base.getRange(k, a, b)).subarray(0, a === 0 ? undefined : 10) }
    const ql = SHAPES(51.85, -1.2, 52.15, -0.8)['node only']
    expect(await getTilePois(parseQuery(ql), ql, { store: short })).toBeNull()
  })
})

describe('header LRU', () => {
  beforeEach(() => _resetTileState())
  it('evicts the least recently used past HEADER_LRU_MAX, a get refreshes recency', () => {
    for (let i = 0; i < HEADER_LRU_MAX; i++) headerCacheSet(`k${i}`, { i })
    expect(headerCacheGet('k0')).toEqual({ i: 0 }) // k0 now most recent
    headerCacheSet('new', { i: -1 })
    expect(headerCacheSize()).toBe(HEADER_LRU_MAX)
    expect(headerCacheGet('k1')).toBeUndefined()
    expect(headerCacheGet('k0')).toEqual({ i: 0 })
    expect(headerCacheGet('new')).toEqual({ i: -1 })
  })
})

describe('r2Store', () => {
  const env = { accessKeyId: 'AKID', secretAccessKey: 'SECRET', endpoint: 'https://acct.r2.cloudflarestorage.com', bucket: 'roam-poi', prefix: 'spike/',
    now: () => new Date('2026-10-26T12:00:00Z') }
  it('signs a path-style Range GET (SigV4 shape) and returns the bytes', async () => {
    let seen
    const store = r2Store({ ...env, fetchImpl: async (url, init) => { seen = { url, init }; return new Response(Buffer.from('abc'), { status: 206 }) } })
    expect((await store.getRange('b/1.abcd.bin', 10, 12)).toString()).toBe('abc')
    expect(seen.url).toBe('https://acct.r2.cloudflarestorage.com/roam-poi/spike/b/1.abcd.bin')
    expect(seen.init.headers.Range).toBe('bytes=10-12')
    expect(seen.init.headers['x-amz-date']).toBe('20261026T120000Z')
    expect(seen.init.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/20261026\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/)
    expect(JSON.stringify(seen)).not.toContain('SECRET')
  })
  it('404 is null; a 200 to a Range request is cut to the range; other errors throw without secrets', async () => {
    const reply = (status, body = '') => r2Store({ ...env, fetchImpl: async () => new Response(body, { status }) })
    expect(await reply(404).get('x')).toBeNull()
    expect((await reply(200, '0123456789').getRange('x', 2, 4)).toString()).toBe('234')
    await expect(reply(403, '<Error><Code>AccessDenied</Code></Error>').get('x')).rejects.toThrow('R2 GET x: 403 AccessDenied')
    expect(() => r2Store({ ...env, bucket: '' })).toThrow(/R2_BUCKET/)
  })
})

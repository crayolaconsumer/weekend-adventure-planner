import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildDiscoverOverpassQuery } from '../../../shared/overpassQuery.js'

const store = new Map()
const kvReads = []
vi.mock('../../../api/lib/kvCache.js', async () => {
  const { createHash } = await import('node:crypto')
  return {
    cacheGet: async key => { kvReads.push(key); return store.get(key) ?? null },
    cacheSet: async (key, value) => { store.set(key, value); return true },
    hashKey: v => createHash('sha1').update(v).digest('hex'),
    isCacheEnabled: () => true,
    getClient: () => null
  }
})
let pct = 0
let shadowPct = 0
let peekFresh = true
let capPct = 0
let flagsNow = () => ({ poiDbPct: pct, poiShadowPct: shadowPct, poiCapPct: capPct })
vi.mock('../../../api/lib/flags.js', () => ({
  getFlags: async () => flagsNow(),
  peekFlags: () => (peekFresh ? flagsNow() : null),
  isFeatureEnabled: async () => true
}))
const background = []
vi.mock('@vercel/functions', () => ({ waitUntil: p => { background.push(p) } }))

let build
let answer
let tableOwner = null
const answerSql = async (opts, params) => {
  if (/^(SET SESSION|START TRANSACTION|ROLLBACK)/.test(opts.sql)) return [[]]
  // the live table's build (its COMMENT): the active build unless a test says otherwise
  if (opts.sql.includes('information_schema.tables')) return [[{ owner: tableOwner ?? build?.build_id }]]
  if (opts.sql.includes('poi_builds')) return [[build]]
  const rows = await answer()
  // the relevance cap's phase 1 (compact candidates) and phase 2 (el by id)
  if (opts.sql.includes('ix_rank')) return [rows.map(candidateOf)]
  if (opts.sql.includes('uq_osm')) return [rows.filter(r => r.osm_type === params[0] && params.slice(1).includes(r.osm_id))]
  return [rows.map(r => ({ g: 0, ...r }))]
}
const poolQuery = vi.fn(answerSql)
// shadow runs on its own connection (poiQuery shadowPois), never the pool
const shadowQuery = vi.fn(answerSql)
const shadowConns = { opened: 0, ended: 0 }
vi.mock('../../../api/lib/db.js', () => ({
  getPool: () => ({ query: poolQuery, getConnection: async () => ({ query: poolQuery, release() {}, destroy() {} }) }),
  getFreshConnection: async () => ({ query: poolQuery, release() {}, destroy() {} }),
  releaseConnection: c => c.release(),
  dedicatedConnection: async () => { shadowConns.opened++; return { query: shadowQuery, end: async () => { shadowConns.ended++ }, destroy() {} } },
  // api/lib/db.js runQuery: the pool path poiQuery uses (7be9cc1), same fake pool
  runQuery: (sql, values = [], timeout) => poolQuery({ sql, values, timeout }, values),
}))

const { default: handler } = await import('../../../api/places/overpass/nearby.js')
const { _resetPoiState, POI_SCHEMA_VERSION, CAP } = await import('../../../api/lib/poiQuery.js')
const { poiFeatures, FEATURES_VERSION } = await import('../../../shared/poiRank.mjs')
function candidateOf(r) {
  const el = JSON.parse(r.el)
  const b = el.bounds || { minlat: el.lat, minlon: el.lon, maxlat: el.lat, maxlon: el.lon }
  return { osm_type: r.osm_type, osm_id: r.osm_id, min_lat: b.minlat, max_lat: b.maxlat, min_lon: b.minlon, max_lon: b.maxlon, ...poiFeatures(el) }
}
// DB runs: each starts with today's statement
const dbRuns = () => poolQuery.mock.calls.filter(c => c[0].sql.startsWith('(SELECT'))
const { cellRanges } = await import('../../../shared/poiCell.mjs')
const GB = cellRanges(49.9, -8, 60.9, 1.8).flatMap(([lo, hi]) => Array.from({ length: hi - lo + 1 }, (_, k) => lo + k))
const { callOverpassProxy } = await import('../../../api/town.js')

const LIVE = { elements: [
  { type: 'node', id: 1, lat: 51.5, lon: -0.12, tags: { name: 'Cafe', amenity: 'cafe' } },
  { type: 'node', id: 2, lat: 51.51, lon: -0.13, tags: { name: 'Pub', amenity: 'pub' } }
] }
const DB_ROWS = [
  { osm_type: 1, osm_id: 1, el: JSON.stringify(LIVE.elements[0]) },
  { osm_type: 1, osm_id: 3, el: '{"type":"node","id":3,"lat":51.52,"lon":-0.11,"tags":{"name":"Bar","amenity":"bar"}}' }
]
const LONDON = buildDiscoverOverpassQuery(51.5074, -0.1278, 5000, null).query

let ip = 0
function call(query, headers = {}) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v },
      status(c) { this.statusCode = c; return this },
      json(body) { resolve({ status: this.statusCode, headers: this.headers, body }); return this },
      send(text) { resolve({ status: this.statusCode, headers: this.headers, body: JSON.parse(text), raw: text }); return this },
      end() { resolve({ status: this.statusCode, headers: this.headers }); return this }
    }
    handler({ method: 'POST', headers: { 'x-forwarded-for': `10.1.0.${++ip}`, ...headers }, body: { query }, socket: {} }, res)
  })
}

describe('overpass nearby: POI table (shadow + served path)', () => {
  let fetchMock
  let logs
  beforeEach(() => {
    shadowQuery.mockImplementation(answerSql)
    store.clear()
    kvReads.length = 0
    background.length = 0
    _resetPoiState()
    poolQuery.mockClear()
    shadowQuery.mockClear()
    Object.assign(shadowConns, { opened: 0, ended: 0 })
    pct = 0
    shadowPct = 100
    capPct = 0
    build = { build_id: 'uk-20260927T0215Z', schema_version: POI_SCHEMA_VERSION, osm_timestamp: '2026-09-27T02:15:00Z', coverage: GB, features_version: FEATURES_VERSION }
    answer = async () => DB_ROWS
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => LIVE }))
    vi.stubGlobal('fetch', fetchMock)
    logs = []
    vi.spyOn(console, 'log').mockImplementation(line => logs.push(line))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const shadowLines = () => logs.filter(l => typeof l === 'string' && l.includes('poi_shadow')).map(l => JSON.parse(l))

  it('pct 0: serves Overpass as before and logs a shadow comparison afterwards', async () => {
    const out = await call(LONDON)
    expect(out.headers['x-places-source']).toBeUndefined()
    expect(out.headers['x-overpass-cache']).toBe('MISS')
    expect(out.body).toEqual(LIVE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await Promise.all(background)
    expect(shadowLines()).toEqual([expect.objectContaining({
      evt: 'poi_shadow', n_live: 2, n_live_named: 2, n_db: 2, jaccard_ids: 0.333, jaccard_raw: 0.333, build: 'uk-20260927T0215Z',
      extra_db: 1, extra_db_sample: ['node/3'], // named DB ids live lacks (bbox-overlap extras)
    })])
    expect(shadowLines()[0].db_ms).toBeTypeOf('number')
  })

  it('unnamed live elements never reach the shadow compare (the trim drops them, as the build does)', async () => {
    const unnamed = { type: 'node', id: 9, lat: 51.5, lon: -0.1, tags: { amenity: 'bench' } }
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ elements: [...LIVE.elements, unnamed] }) }))
    answer = async () => [DB_ROWS[0], { osm_type: 1, osm_id: 2, el: JSON.stringify(LIVE.elements[1]) }]
    await call(LONDON)
    await Promise.all(background)
    expect(shadowLines()[0]).toMatchObject({ n_live: 2, n_live_named: 2, n_db: 2, jaccard_ids: 1, jaccard_raw: 1 })
  })

  it('poiShadowPct 0 (the default): no shadow, no generation read, no DB call at all', async () => {
    shadowPct = 0
    await call(LONDON)
    await call(LONDON)
    await Promise.all(background)
    expect(shadowLines()).toHaveLength(0)
    expect(kvReads).not.toContain('roam:poiGen')
    expect(poolQuery).not.toHaveBeenCalled()
  })

  it('shadow runs on its own connection, at most once per tile per 10 min: a hot tile costs one DB run and one comparison', async () => {
    for (let i = 0; i < 5; i++) {
      await call(LONDON)
      await Promise.all(background)
    }
    expect(dbRuns()).toHaveLength(0) // never the pool (pct 0: nothing served from the DB)
    expect(shadowConns).toEqual({ opened: 1, ended: 1 })
    expect(shadowLines()).toHaveLength(1)
    expect(shadowLines()[0]).toMatchObject({ live_src: 'overpass', n_db: 2, n_scanned: 2, rank_ms: null, capped: false }) // under the cap: not ranked
    // a different tile is its own comparison
    await call(buildDiscoverOverpassQuery(53.959, -1.0815, 5000, null).query)
    await Promise.all(background)
    expect(shadowConns.opened).toBe(2)
  })

  it('cap shadow is sampled whatever poiDbPct: DB-served answers are compared too (live_src db)', async () => {
    pct = 100
    const many = Array.from({ length: CAP + 500 }, (_, i) => ({ osm_type: 1, osm_id: 10 + i,
      el: JSON.stringify({ type: 'node', id: 10 + i, lat: 51.47 + (i % 70) / 1000, lon: -0.2 + Math.floor(i / 70) / 1000, tags: { name: `Cafe ${i}`, amenity: 'cafe' } }) }))
    answer = async () => many
    const out = await call(LONDON)
    expect(out.headers['x-places-source']).toBe('db')
    expect(out.body.elements).toHaveLength(CAP + 500) // served uncapped (poiCapPct 0)
    await Promise.all(background)
    expect(shadowLines()).toEqual([expect.objectContaining({ live_src: 'db', n_live: CAP + 500, n_db: CAP, capped: true })])
  })

  it('INVARIANT (poiCapPct 0): shadow and cap failures of every kind never change served answers, the shared breaker or admission', async () => {
    pct = 100
    const { breakerState } = await import('../../../api/lib/poiQuery.js')
    const many = Array.from({ length: CAP + 500 }, (_, i) => ({ osm_type: 1, osm_id: 10 + i,
      el: JSON.stringify({ type: 'node', id: 10 + i, lat: 51.47 + (i % 70) / 1000, lon: -0.2 + Math.floor(i / 70) / 1000, tags: { name: `Cafe ${i}`, amenity: 'cafe' } }) }))
    const failures = [
      Object.assign(new Error("Key 'ix_rank' doesn't exist in table 'pois'"), { errno: 1176 }), // before phase12
      Object.assign(new Error('Query execution was interrupted, maximum statement execution time exceeded'), { errno: 3024 }),
      Object.assign(new Error('You have an error in your SQL syntax'), { errno: 1064 }),
    ]
    // reference: what a served request gets with shadow off
    shadowPct = 0
    answer = async () => many
    const expected = (await call(LONDON)).raw
    shadowPct = 100
    _resetPoiState() // one instance through all 12 failures: nothing may accumulate in the shared breaker
    for (const [n, failure] of failures.entries()) {
      for (let i = 0; i < 4; i++) {
        store.clear()
        // every statement a shadow run sends fails; served statements succeed (distinct tiles:
        // shadow runs once per tile)
        shadowQuery.mockImplementation(async opts => { if (/ix_rank|^\(SELECT/.test(opts.sql)) throw failure; return answerSql(opts) })
        const served = await call(buildDiscoverOverpassQuery(51.3 + n * 0.1 + i * 0.02, -0.1278, 5000, null).query)
        await Promise.all(background)
        expect(served.headers['x-places-source']).toBe('db')
        expect(breakerState()).toBe('closed')
      }
    }
    expect(shadowConns.opened).toBe(12) // every shadow ran (and failed), on its own connection
    // and with no served success in between to reset it (pct 0: shadow only), failures still
    // never reach the shared breaker
    pct = 0
    shadowQuery.mockImplementation(async opts => { if (/ix_rank|^\(SELECT/.test(opts.sql)) throw failures[0]; return answerSql(opts) })
    for (let i = 0; i < 4; i++) {
      await call(buildDiscoverOverpassQuery(52.5 + i * 0.05, -1.5, 5000, null).query)
      await Promise.all(background)
    }
    expect(shadowConns.opened).toBe(16)
    expect(breakerState()).toBe('closed')
    pct = 100
    shadowQuery.mockImplementation(answerSql)
    // same answer as with shadow off, byte for byte
    _resetPoiState()
    expect((await call(LONDON)).raw).toBe(expected)
    expect(poolQuery.mock.calls.some(c => c[0].sql.includes('ix_rank'))).toBe(false) // cap work never on the pool
  })

  it('shadow of a dense tile logs the capped answer: candidates scanned and rank time', async () => {
    const many = Array.from({ length: CAP + 500 }, (_, i) => ({ osm_type: 1, osm_id: 10 + i,
      el: JSON.stringify({ type: 'node', id: 10 + i, lat: 51.47 + (i % 70) / 1000, lon: -0.2 + Math.floor(i / 70) / 1000, tags: { name: `Cafe ${i}`, amenity: 'cafe' } }) }))
    answer = async () => many
    await call(LONDON)
    await Promise.all(background)
    expect(shadowLines()[0]).toMatchObject({ n_db: CAP, n_scanned: CAP + 500, capped: true, cap_fallback: null })
    // phase timings, split out, so the cap is measured before it serves (poiCapPct 0 here)
    for (const k of ['rank_ms', 'probe_ms', 'candidates_ms', 'el_ms']) expect(shadowLines()[0][k], k).toBeTypeOf('number')
  })

  const dense = () => Array.from({ length: CAP + 500 }, (_, i) => ({ osm_type: 1, osm_id: 10 + i,
    el: JSON.stringify({ type: 'node', id: 10 + i, lat: 51.47 + (i % 70) / 1000, lon: -0.2 + Math.floor(i / 70) / 1000, tags: { name: `Cafe ${i}`, amenity: 'cafe' } }) }))

  it('poiCapPct 0 (the default, fail closed): a served dense tile is served exactly as before, uncapped', async () => {
    pct = 100
    answer = async () => dense()
    const out = await call(LONDON)
    expect(out.headers['x-places-source']).toBe('db')
    expect(out.body.elements).toHaveLength(CAP + 500)
    expect(poolQuery.mock.calls.some(c => c[0].sql.includes('ix_rank'))).toBe(false) // no probe, no cap
  })

  it('poiCapPct 100: the same tile is served capped; a flag read failure keeps it off', async () => {
    pct = 100
    capPct = 100
    answer = async () => dense()
    expect((await call(LONDON)).body.elements).toHaveLength(CAP)
    // a flag store that won't answer: POI off entirely, so certainly no cap
    _resetPoiState()
    peekFresh = false
    const real = flagsNow
    flagsNow = () => new Promise(() => {})
    try {
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBeUndefined()
    } finally {
      flagsNow = real
      peekFresh = true
    }
  })

  // one slow statement (a cold page read): the whole DB answer takes ~1.6 s
  const slowOnce = () => {
    let slow = true
    return () => (slow ? (slow = false, new Promise(resolve => setTimeout(() => resolve(dense()), 1600))) : dense())
  }

  it('dense tile, cap on: a capped answer that takes 1.6 s is still served from the DB (the fallback is Overpass timing out)', async () => {
    pct = 100
    capPct = 100
    answer = slowOnce()
    const out = await call(LONDON)
    expect(out.headers['x-places-source']).toBe('db')
    expect(out.body.elements).toHaveLength(CAP)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cap on, cold instance: a first try that fails gets one more, served from the DB (regression: London 27 s on a new deploy)', async () => {
    pct = 100
    capPct = 100
    let first = true
    answer = async () => { if (first) { first = false; throw new Error('too close to the deadline') } return dense() }
    const out = await call(LONDON)
    expect(out.headers['x-places-source']).toBe('db')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cap on, DB keeps failing: two tries, then Overpass', async () => {
    pct = 100
    capPct = 100
    let tries = 0
    answer = async () => { tries++; throw new Error('PROTOCOL_SEQUENCE_TIMEOUT') }
    const out = await call(LONDON)
    expect(tries).toBe(2)
    expect(out.headers['x-overpass-cache']).toBe('MISS')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('cap on, DB slow, KV warm: the cached copy is served at ~1 s as before (only an empty KV waits longer for the cap)', async () => {
    await call(LONDON) // pct 0: Overpass answers and fills KV
    expect(fetchMock).toHaveBeenCalledTimes(1)
    pct = 100
    capPct = 100
    answer = slowOnce()
    const t = Date.now()
    const out = await call(LONDON)
    expect(Date.now() - t).toBeLessThan(1400)
    expect(out.headers['x-overpass-cache']).toBe('HIT')
    expect(out.body).toEqual(LIVE)
    expect(fetchMock).toHaveBeenCalledTimes(1) // no second Overpass call
  })

  it('cap on: a plan the cap can never serve (a town page, limited outputs) keeps the 1 s wait', async () => {
    const { townOverpassQuery } = await import('../../../api/lib/towns.js')
    pct = 100
    capPct = 100
    answer = slowOnce()
    const t = Date.now()
    const out = await call(townOverpassQuery(51.5074, -0.1278))
    expect(Date.now() - t).toBeLessThan(1400)
    expect(out.headers['x-places-source']).toBeUndefined()
    expect(out.body).toEqual(LIVE)
  })

  it('cap off: the same 1.6 s DB answer still loses to the old path after ~1 s (only the cap gets longer)', async () => {
    pct = 100
    capPct = 0
    answer = slowOnce()
    const out = await call(LONDON)
    expect(out.headers['x-places-source']).toBeUndefined()
    expect(out.body).toEqual(LIVE)
  })

  it('pct 100 + a DB that never answers: the old path serves after ~1 s', async () => {
    pct = 100
    answer = () => new Promise(() => {})
    const t = Date.now()
    const out = await call(LONDON)
    expect(Date.now() - t).toBeLessThan(2500)
    // the abandoned DB run stays in waitUntil, so the instance lives until its transaction ends
    expect(background).toHaveLength(4) // the DB run, the two KV writes of the Overpass answer, its shadow
    expect(out.headers['x-places-source']).toBeUndefined()
    expect(out.body).toEqual(LIVE)
  })

  it('a KV hit never waits on a slow flag store (50 ms, then POI off)', async () => {
    await call(LONDON)
    await Promise.all(background)
    peekFresh = false
    const real = flagsNow
    flagsNow = () => new Promise(() => {})
    try {
      const t = Date.now()
      const hit = await call(LONDON)
      expect(hit.headers['x-overpass-cache']).toBe('HIT')
      expect(Date.now() - t).toBeLessThan(500)
    } finally {
      flagsNow = real
      peekFresh = true
    }
  })

  it('logs bucket and covered on every places line', async () => {
    pct = 100
    await call(LONDON)
    await call('[out:json][timeout:25];node(around:500,51.5,-0.12)["amenity"="cafe"];out center;')
    const places = logs.filter(l => typeof l === 'string' && l.includes('"evt":"places"')).map(l => JSON.parse(l))
    expect(places[0]).toMatchObject({ src: 'db', covered: true })
    expect(places[0].bucket).toBeGreaterThanOrEqual(0)
    expect(places[0].bucket).toBeLessThan(100)
    expect(places[1]).toMatchObject({ src: 'overpass', bucket: null, covered: false })
  })

  it('pct 0: shadows KV hits too', async () => {
    await call(LONDON)
    await Promise.all(background)
    _resetPoiState() // a fresh instance: nothing compared yet
    const hit = await call(LONDON)
    expect(hit.headers['x-overpass-cache']).toBe('HIT')
    await Promise.all(background)
    expect(shadowLines()).toHaveLength(2)
  })

  it('pct 0: an uncovered or unparseable query gets no DB call at all', async () => {
    build = { ...build, coverage: [] }
    await call(LONDON)
    await call('[out:json][timeout:25];node(around:500,51.5,-0.12)["amenity"="cafe"];out center;')
    await Promise.all(background)
    expect(shadowLines()).toHaveLength(0)
    expect(dbRuns()).toHaveLength(0)
  })

  it('pct 100 + covered + rows: served from the DB, no Overpass, no KV write', async () => {
    pct = 100
    const out = await call(LONDON)
    expect(out.status).toBe(200)
    expect(out.headers['x-places-source']).toBe('db')
    expect(out.headers['x-places-build']).toBe('uk-20260927T0215Z')
    expect(out.headers['content-type']).toMatch(/application\/json/)
    expect(out.headers['cache-control']).toBe('s-maxage=86400, stale-while-revalidate=172800')
    expect(out.body.elements.map(e => e.id)).toEqual([1, 3])
    expect(out.body.generator).toBe('roam-poi-db')
    const line = logs.map(l => (typeof l === 'string' && l.includes('"evt":"places"') ? JSON.parse(l) : null)).find(Boolean)
    expect(line).toMatchObject({ src: 'db', n: 2, db_scanned: 2, db_cached: false })
    expect(fetchMock).not.toHaveBeenCalled()
    expect([...store.keys()].filter(k => k !== 'roam:poiCoverage')).toEqual([]) // only the coverage copy (poiQuery), never the answer
  })

  it('a roam:poiGen bump in KV (after a swap or rollback) stops cached DB answers being served', async () => {
    pct = 100
    expect((await call(LONDON)).headers['x-places-source']).toBe('db')
    expect((await call(LONDON)).headers['x-places-source']).toBe('db') // from the LRU
    expect(dbRuns()).toHaveLength(1)
    store.set('roam:poiGen', 1) // the loader's INCR
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 31_000) // past the 30 s generation cache
      await call(LONDON) // last-known gen 0 (never waits on KV), starts the refresh
      await new Promise(resolve => setTimeout(resolve, 0))
      await call(LONDON)
      // From the next request on, never the gen 0 LRU copy: a fresh query under gen 1 (or the old path)
      const poiQueries = dbRuns().length
      expect(poiQueries + fetchMock.mock.calls.length).toBe(2)
      expect(poolQuery.mock.calls.filter(c => c[0].sql.includes('poi_builds'))).toHaveLength(2) // coverage reloaded for gen 1
    } finally {
      vi.useRealTimers()
    }
  })

  it('pct 100: crawlers get the DB path (it costs Overpass nothing)', async () => {
    pct = 100
    const out = await call(LONDON, { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' })
    expect(out.headers['x-places-source']).toBe('db')
  })

  it('pct 100: in-process callers without res.send (town pages) get the parsed body', async () => {
    pct = 100
    const { status, body } = await callOverpassProxy(LONDON, '10.2.0.1', handler, 5000)
    expect(status).toBe(200)
    expect(body.elements).toHaveLength(2)
  })

  it('pct 100 + DB error: falls through to KV/Overpass unchanged', async () => {
    pct = 100
    answer = async () => { throw new Error('PROTOCOL_SEQUENCE_TIMEOUT') }
    const out = await call(LONDON)
    expect(out.headers['x-places-source']).toBeUndefined()
    expect(out.headers['x-overpass-cache']).toBe('MISS')
    expect(out.body).toEqual(LIVE)
  })

  it('pct 100: a bare-id place link is answered from the DB when it holds the node, else Overpass', async () => {
    // Regression: every bare-id /place link went to Overpass (10-20 s on 2 Oct)
    pct = 100
    const bare = '[out:json][timeout:10];(node(1);way(1););out body center;'
    const out = await call(bare)
    expect(out.headers['x-places-source']).toBe('db')
    expect(out.body.elements.map(e => `${e.type}/${e.id}`)).toEqual(['node/1'])
    expect(fetchMock).not.toHaveBeenCalled()
    // Only the way in the DB: it could lose to a node outside the build, so Overpass decides
    store.clear()
    _resetPoiState()
    answer = async () => [{ osm_type: 2, osm_id: 1, el: '{"type":"way","id":1,"center":{"lat":51.5,"lon":-0.1},"tags":{"name":"Park","leisure":"park"}}' }]
    expect((await call(bare)).body).toEqual(LIVE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('pct 100 + 0 rows or not covered: falls through', async () => {
    pct = 100
    answer = async () => []
    expect((await call(LONDON)).body).toEqual(LIVE)
    store.clear()
    _resetPoiState()
    build = { ...build, coverage: [] }
    expect((await call(LONDON)).body).toEqual(LIVE)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rollout bucket: pct 50 splits tiles stably', async () => {
    pct = 50
    const sources = []
    for (let i = 0; i < 40; i++) {
      const q = buildDiscoverOverpassQuery(51 + i * 0.05, -1, 5000, null).query
      // A shadow comparison still running holds the instance's one SQL slot, so let it finish
      const first = await call(q)
      await Promise.all(background)
      const again = await call(q)
      await Promise.all(background)
      expect(again.headers['x-places-source']).toBe(first.headers['x-places-source'])
      sources.push(first.headers['x-places-source'] === 'db')
    }
    expect(sources.filter(Boolean).length).toBeGreaterThan(5)
    expect(sources.filter(s => !s).length).toBeGreaterThan(5)
  })
})

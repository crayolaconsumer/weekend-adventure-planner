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
let flagsNow = () => ({ poiDbPct: pct, poiShadowPct: shadowPct })
vi.mock('../../../api/lib/flags.js', () => ({
  getFlags: async () => flagsNow(),
  peekFlags: () => (peekFresh ? flagsNow() : null),
  isFeatureEnabled: async () => true
}))
const background = []
vi.mock('@vercel/functions', () => ({ waitUntil: p => { background.push(p) } }))

let build
let answer
const poolQuery = vi.fn(async opts => {
  if (opts.sql.includes('poi_builds')) return [[build]]
  return [(await answer()).map(r => ({ g: 0, ...r }))]
})
vi.mock('../../../api/lib/db.js', () => ({ getPool: () => ({ query: poolQuery }) }))

const { default: handler } = await import('../../../api/places/overpass/nearby.js')
const { _resetPoiState } = await import('../../../api/lib/poiQuery.js')
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
    store.clear()
    kvReads.length = 0
    background.length = 0
    _resetPoiState()
    poolQuery.mockClear()
    pct = 0
    shadowPct = 100
    build = { build_id: 'uk-20260927T0215Z', schema_version: 1, osm_timestamp: '2026-09-27T02:15:00Z', coverage: GB }
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
      evt: 'poi_shadow', n_live: 2, n_live_named: 2, n_db: 2, jaccard_ids: 0.333, jaccard_raw: 0.333, build: 'uk-20260927T0215Z'
    })])
    expect(shadowLines()[0].db_ms).toBeTypeOf('number')
  })

  it('shadow compares against live named elements only (the build drops unnamed ones)', async () => {
    const unnamed = { type: 'node', id: 9, lat: 51.5, lon: -0.1, tags: { amenity: 'bench' } }
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ elements: [...LIVE.elements, unnamed] }) }))
    answer = async () => [DB_ROWS[0], { osm_type: 1, osm_id: 2, el: JSON.stringify(LIVE.elements[1]) }]
    await call(LONDON)
    await Promise.all(background)
    expect(shadowLines()[0]).toMatchObject({ n_live: 3, n_live_named: 2, n_db: 2, jaccard_ids: 1, jaccard_raw: 0.667 })
  })

  it('poiShadowPct 0 (the default): no shadow and no DB call at all', async () => {
    shadowPct = 0
    await call(LONDON)
    await call(LONDON)
    await Promise.all(background)
    expect(shadowLines()).toHaveLength(0)
    expect(poolQuery).not.toHaveBeenCalled()
  })

  it('shadow queries hit the DB every time (no LRU), so db_ms is real', async () => {
    await call(LONDON)
    await Promise.all(background)
    await call(LONDON)
    await Promise.all(background)
    expect(poolQuery.mock.calls.filter(c => !c[0].sql.includes('poi_builds'))).toHaveLength(2)
  })

  it('pct 100 + a DB that never answers: the old path serves after ~1 s', async () => {
    pct = 100
    answer = () => new Promise(() => {})
    const t = Date.now()
    const out = await call(LONDON)
    expect(Date.now() - t).toBeLessThan(2500)
    expect(out.headers['x-places-source']).toBeUndefined()
    expect(out.body).toEqual(LIVE)
  })

  it('shadow reports named DB ids that live lacks (bbox-overlap extras)', async () => {
    await call(LONDON)
    await Promise.all(background)
    expect(shadowLines()[0]).toMatchObject({ extra_db: 1, extra_db_sample: ['node/3'] })
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

  it('both percentages 0 (cached flags): no generation read and no SQL at all', async () => {
    shadowPct = 0
    await call(LONDON)
    await call(LONDON)
    expect(kvReads).not.toContain('roam:poiGen')
    expect(poolQuery).not.toHaveBeenCalled()
  })

  it('pct 0: shadows KV hits too', async () => {
    await call(LONDON)
    await Promise.all(background)
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
    expect(poolQuery.mock.calls.filter(c => !c[0].sql.includes('poi_builds'))).toHaveLength(0)
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
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.size).toBe(0)
  })

  it('a roam:poiGen bump in KV (after a swap or rollback) stops cached DB answers being served', async () => {
    pct = 100
    expect((await call(LONDON)).headers['x-places-source']).toBe('db')
    expect((await call(LONDON)).headers['x-places-source']).toBe('db') // from the LRU
    expect(poolQuery.mock.calls.filter(c => !c[0].sql.includes('poi_builds'))).toHaveLength(1)
    store.set('roam:poiGen', 1) // the loader's INCR
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 31_000) // past the 30 s generation cache
      await call(LONDON)
      // Never the gen 0 LRU copy: a fresh query under gen 1 (or the old path)
      const poiQueries = poolQuery.mock.calls.filter(c => !c[0].sql.includes('poi_builds')).length
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
      const first = await call(q)
      const again = await call(q)
      expect(again.headers['x-places-source']).toBe(first.headers['x-places-source'])
      sources.push(first.headers['x-places-source'] === 'db')
    }
    expect(sources.filter(Boolean).length).toBeGreaterThan(5)
    expect(sources.filter(s => !s).length).toBeGreaterThan(5)
  })
})

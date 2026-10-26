import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { buildDiscoverOverpassQuery } from '../../../shared/overpassQuery.js'
import { snapQueryBbox } from '../../../api/lib/bboxSnap.js'
import { townOverpassQuery } from '../../../api/lib/towns.js'

// Worldwide path (outside the POI DB's GB + Ireland box): stale-while-revalidate, the
// Overpass vs GeoApify race, the GeoApify credit cap and the trace line. Upstreams mocked.

const store = new Map()
let kvOff = false // getClient() null: KV not provisioned
const counters = new Map()
let locks
const kvClient = {
  pipeline: () => ({ incr() { return this }, expire() { return this }, exec: async () => [1, 1] }),
  set: vi.fn(async (key, _v, opts) => {
    if (opts?.nx && locks.has(key)) return null
    locks.add(key)
    return 'OK'
  }),
  del: vi.fn(async key => { locks.delete(key); counters.delete(key); return 1 }),
  exists: vi.fn(async key => (locks.has(key) ? 1 : 0)),
  get: vi.fn(async key => counters.get(key) ?? null),
  incrby: vi.fn(async (key, n) => { counters.set(key, (counters.get(key) || 0) + n); return counters.get(key) }),
  decrby: vi.fn(async (key, n) => { counters.set(key, (counters.get(key) || 0) - n); return counters.get(key) }),
  incr: vi.fn(async key => { counters.set(key, (counters.get(key) || 0) + 1); return counters.get(key) }),
  expire: vi.fn(async () => 1),
}
const cacheGet = vi.fn(async key => store.get(key) ?? null)
const cacheSet = vi.fn(async (key, value) => { store.set(key, value); return true })
vi.mock('../../../api/lib/kvCache.js', async () => {
  const { createHash } = await import('node:crypto')
  return {
    cacheGet: (...a) => cacheGet(...a),
    cacheSet: (...a) => cacheSet(...a),
    hashKey: v => createHash('sha1').update(v).digest('hex'),
    isCacheEnabled: () => true,
    getClient: () => (kvOff ? null : kvClient),
  }
})
vi.mock('../../../api/lib/flags.js', () => ({ isFeatureEnabled: async () => true }))
const background = []
vi.mock('@vercel/functions', () => ({ waitUntil: p => { background.push(p); return p } }))

const { default: handler, backoffSeconds } = await import('../../../api/places/overpass/nearby.js')

const sha = v => createHash('sha1').update(v).digest('hex')
const SYDNEY = () => buildDiscoverOverpassQuery(-33.8688, 151.2093, 5000, null).query
const LONDON = () => buildDiscoverOverpassQuery(51.5074, -0.1278, 5000, null).query
const keysOf = q => {
  const h = sha(snapQueryBbox(q))
  return { fresh: `overpass:${h}`, stale: `overpass:stale:${h}`, ga: `overpass:ga:${h}`, lock: `overpass:lock:${h}` }
}
const creditKey = () => `geoapify:credits:${new Date().toISOString().slice(0, 10)}`

const OVERPASS_BODY = { elements: [{ type: 'node', id: 1, lat: -33.87, lon: 151.21, tags: { name: 'Overpass Cafe', amenity: 'cafe' } }] }
const STALE_BODY = { elements: [{ type: 'node', id: 2, lat: -33.87, lon: 151.21, tags: { name: 'Stale Cafe', amenity: 'cafe' } }] }
// Shaped like a live GeoApify answer (Sydney, 26 Oct 2026)
const gaFeature = (osm_type, osm_id, tags, lon = 151.2, lat = -33.87) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: {
    name: tags.name, lat, lon, categories: ['catering', 'catering.cafe'], place_id: `p${osm_id}`,
    datasource: { sourcename: 'openstreetmap', raw: { lat, lon, osm_id, osm_type, ...tags } },
  },
})
const GA_FEATURES = [
  gaFeature('n', 2163387594, { name: 'Grounded 2050', amenity: 'cafe', opening_hours: 'Mo-Fr 06:00-15:00' }),
  gaFeature('w', 44, { name: 'Hyde Park', leisure: 'park' }),
]
const okJson = body => ({ ok: true, status: 200, json: async () => body })

let overpassRelease, overpassCalls, gaCalls, gaRelease
function routeFetch({ overpass = 'hang', geoapify = GA_FEATURES } = {}) {
  overpassCalls = 0
  gaCalls = 0
  const fetchMock = vi.fn(url => {
    if (String(url).includes('geoapify')) {
      gaCalls++
      if (geoapify === 'hang') return new Promise(() => {})
      if (geoapify === 'held') return new Promise(r => { const prev = gaRelease; gaRelease = () => { prev?.(); r(okJson({ type: 'FeatureCollection', features: GA_FEATURES })) } })
      if (geoapify === 'fail') return Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
      return Promise.resolve(okJson({ type: 'FeatureCollection', features: geoapify }))
    }
    overpassCalls++
    if (overpass === 'hang') return new Promise(r => { overpassRelease = () => r(okJson(OVERPASS_BODY)) })
    if (overpass === 'fail') return Promise.resolve({ ok: false, status: 429, text: async () => '' })
    return Promise.resolve(okJson(OVERPASS_BODY))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

let ip = 0
function call(query, headers = {}) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v },
      status(c) { this.statusCode = c; return this },
      json(body) { resolve({ status: this.statusCode, headers: this.headers, body }); return this },
      end() { resolve({ status: this.statusCode, headers: this.headers }); return this },
    }
    handler({ method: 'POST', headers: { 'x-forwarded-for': `10.1.0.${++ip}`, ...headers }, body: { query }, socket: {} }, res)
  })
}
const placesLines = spy => spy.mock.calls.map(c => { try { return JSON.parse(c[0]) } catch { return null } }).filter(l => l?.evt === 'places')
const settle = () => new Promise(r => setTimeout(r, 10))

describe('overpass nearby: worldwide first visit', () => {
  let log
  beforeEach(() => {
    store.clear()
    counters.clear()
    locks = new Set()
    background.length = 0
    process.env.GEOAPIFY_API_KEY = 'test-key'
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    delete process.env.GEOAPIFY_API_KEY
    delete process.env.CRON_SECRET
    log.mockRestore()
    vi.unstubAllGlobals()
  })

  it('a stale copy is served at once, and one background refresh fills the fresh copy', async () => {
    const k = keysOf(SYDNEY())
    store.set(k.stale, STALE_BODY)
    routeFetch({ overpass: 'hang' })
    const [a, b] = await Promise.all([call(SYDNEY()), call(SYDNEY())])
    for (const out of [a, b]) {
      expect(out.status).toBe(200)
      expect(out.body.elements[0].tags.name).toBe('Stale Cafe')
      expect(out.headers['x-overpass-fallback']).toBe('swr')
    }
    await settle()
    expect(overpassCalls).toBe(1) // two visitors, one refresh (the lock)
    expect(gaCalls).toBe(0) // a cached copy never spends credits
    overpassRelease()
    await Promise.all(background)
    await settle()
    expect(store.get(k.fresh)).toEqual(OVERPASS_BODY)
    expect(locks.size).toBe(0)
    const lines = placesLines(log)
    expect(lines.map(l => [l.src, l.swr])).toEqual([['stale', true], ['stale', true]])
    expect(log.mock.calls.some(c => String(c[0]).includes('"evt":"overpass_fetch","ok":true'))).toBe(true)
  })

  it('Overpass slow: GeoApify answers with OSM ids and tags, Overpass carries on and fills KV', async () => {
    const k = keysOf(SYDNEY())
    routeFetch({ overpass: 'hang' })
    const out = await call(SYDNEY())
    expect(out.status).toBe(200)
    expect(out.headers['x-overpass-fallback']).toBe('geoapify')
    expect(out.body.elements).toEqual([
      { type: 'node', id: 2163387594, lat: -33.87, lon: 151.2, tags: { name: 'Grounded 2050', amenity: 'cafe', opening_hours: 'Mo-Fr 06:00-15:00' } },
      { type: 'way', id: 44, center: { lat: -33.87, lon: 151.2 }, tags: { name: 'Hyde Park', leisure: 'park' } },
    ])
    expect(overpassCalls).toBe(1)
    await settle()
    expect(store.get(k.ga)).toEqual(out.body) // its own key, never the Overpass one
    expect(store.has(k.fresh)).toBe(false)
    expect(counters.get(creditKey())).toBe(3) // reserved 6 (worst case), refunded 3: three groups, 1 credit each
    const [line] = placesLines(log)
    expect(line).toMatchObject({ src: 'geoapify', n: 2, ga_credits: 3 })
    expect(typeof line.ms).toBe('number')
    expect(typeof line.ga_ms).toBe('number')
    overpassRelease()
    await Promise.all(background)
    await settle()
    expect(store.get(k.fresh)).toEqual(OVERPASS_BODY)
    expect(store.get(k.stale)).toEqual(OVERPASS_BODY)
    // Next visit: the fresh Overpass copy, not the GeoApify one
    const again = await call(SYDNEY())
    expect(again.headers['x-overpass-cache']).toBe('HIT')
    expect(again.body).toEqual(OVERPASS_BODY)
  })

  it('the stale copy is kept 30 days outside the DB region, 7 inside it', async () => {
    routeFetch({ overpass: 'ok', geoapify: 'hang' })
    await call(SYDNEY())
    await call(LONDON())
    await settle() // GeoApify hangs here: wait for the cache writes, not for it
    const ttl = key => cacheSet.mock.calls.find(c => c[0] === key)?.[2]
    expect(ttl(keysOf(SYDNEY()).stale)).toBe(30 * 24 * 60 * 60)
    expect(ttl(keysOf(LONDON()).stale)).toBe(7 * 24 * 60 * 60)
  })

  it('Overpass errors fast: GeoApify answers (regression: Mexico City 503 in 1.1 s)', async () => {
    routeFetch({ overpass: 'fail' })
    const out = await call(SYDNEY())
    expect(out.status).toBe(200)
    expect(out.headers['x-overpass-fallback']).toBe('geoapify')
    expect(out.body.elements).toHaveLength(2)
  })

  it('Overpass first: its answer is served', async () => {
    routeFetch({ overpass: 'ok', geoapify: 'hang' })
    const out = await call(SYDNEY())
    expect(out.headers['x-overpass-cache']).toBe('MISS')
    expect(out.body).toEqual(OVERPASS_BODY)
    expect(placesLines(log)[0].src).toBe('overpass')
  })

  it('both fail: the 503 is as before', async () => {
    routeFetch({ overpass: 'fail', geoapify: 'fail' })
    const out = await call(SYDNEY())
    expect(out.status).toBe(503)
  })

  it('a second visit inside 24 h gets the GeoApify copy at once and triggers one Overpass refresh', async () => {
    const k = keysOf(SYDNEY())
    store.set(k.ga, { elements: [OVERPASS_BODY.elements[0]] })
    routeFetch({ overpass: 'ok' })
    const out = await call(SYDNEY())
    expect(out.headers['x-overpass-fallback']).toBe('swr')
    expect(placesLines(log)[0]).toMatchObject({ src: 'geoapify', swr: true })
    await Promise.all(background)
    expect(gaCalls).toBe(0)
    expect(overpassCalls).toBe(1)
    expect(store.get(k.fresh)).toEqual(OVERPASS_BODY)
  })

  it('no GeoApify call when KV answers fresh', async () => {
    store.set(keysOf(SYDNEY()).fresh, OVERPASS_BODY)
    const fetchMock = routeFetch()
    const out = await call(SYDNEY())
    expect(out.headers['x-overpass-cache']).toBe('HIT')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('GB is unchanged: no stale-while-revalidate, no GeoApify, Overpass failures still 503', async () => {
    store.set(keysOf(LONDON()).stale, STALE_BODY)
    routeFetch({ overpass: 'ok' })
    const fresh = await call(LONDON()) // a stale copy exists, but GB fetches synchronously
    expect(fresh.body).toEqual(OVERPASS_BODY)
    store.clear()
    routeFetch({ overpass: 'fail' })
    const out = await call(LONDON())
    expect(out.status).toBe(503)
    expect(gaCalls).toBe(0)
  })

  it('budget guard: when the worst case (6) would pass the 2,400 fallback cap, GeoApify is not called and Overpass is awaited', async () => {
    counters.set(creditKey(), 2395)
    routeFetch({ overpass: 'hang' })
    const pending = call(SYDNEY())
    await settle()
    expect(gaCalls).toBe(0)
    overpassRelease()
    const out = await pending
    expect(out.body).toEqual(OVERPASS_BODY)
    expect(placesLines(log)[0]).toMatchObject({ src: 'overpass', ga_capped: true })
    expect(counters.get(creditKey())).toBe(2395) // the refused reservation was rolled back
  })

  it('when the worst case just fits (2,394 + 6 = 2,400) GeoApify still answers', async () => {
    counters.set(creditKey(), 2394)
    routeFetch({ overpass: 'hang' })
    const out = await call(SYDNEY())
    expect(out.headers['x-overpass-fallback']).toBe('geoapify')
    await settle() // Overpass is still hanging: wait for the refund, not for it
    expect(counters.get(creditKey())).toBe(2397) // 3 spent, 3 refunded
  })

  it('no API key: behaves as before (Overpass awaited)', async () => {
    delete process.env.GEOAPIFY_API_KEY
    routeFetch({ overpass: 'ok' })
    const out = await call(SYDNEY())
    expect(out.body).toEqual(OVERPASS_BODY)
    expect(gaCalls).toBe(0)
  })

  it('the prewarm cron (bearer) skips the stale copy and GeoApify and waits for Overpass', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    store.set(keysOf(SYDNEY()).stale, STALE_BODY)
    routeFetch({ overpass: 'ok' })
    const out = await call(SYDNEY(), { authorization: 'Bearer cron-secret' })
    expect(out.headers['x-overpass-cache']).toBe('MISS')
    expect(out.body).toEqual(OVERPASS_BODY)
    expect(gaCalls).toBe(0)
  })

  it('a town-page query outside GB/IE is answered by GeoApify when Overpass fails (regression: /town/bruges 503)', async () => {
    routeFetch({ overpass: 'fail', geoapify: [gaFeature('n', 5, { name: 'Belfort', tourism: 'attraction' }), gaFeature('n', 6, { name: 'Markt Cafe', amenity: 'cafe' })] })
    const q = townOverpassQuery(51.2093, 3.2247)
    const out = await call(q)
    expect(out.status).toBe(200)
    expect(out.body.generator).toBe('geoapify')
    expect(out.body.elements.map(e => e.tags.name).sort()).toEqual(['Belfort', 'Markt Cafe'])
    await settle()
    expect(store.get(keysOf(q).ga)).toEqual(out.body) // its own key
  })

  it('end to end: /town/bruges with Overpass down renders 200 with places, cached 10 min (was a 503)', async () => {
    const { createHandler } = await import('../../../api/town.js')
    routeFetch({ overpass: 'fail', geoapify: [gaFeature('n', 5, { name: 'Belfort', tourism: 'attraction', wikidata: 'Q1' }, 3.2247, 51.2083)] })
    const page = createHandler({ gate: async () => {}, ticketmaster: async (_q, r) => r.status(200).json({}) })
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v }, status(c) { this.statusCode = c; return this }, send(b) { this.body = b; return this }, json(b) { this.body = b; return this }, end() { return this } }
    await page({ method: 'GET', query: { slug: 'bruges' }, headers: { 'x-forwarded-for': '10.9.9.9' } }, res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Belfort')
    expect(res.headers['cache-control']).toBe('public, s-maxage=600')
  })

  it('crawlers never make a GeoApify call, cold or not; they may read a copy a visitor paid for', async () => {
    const UA = { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }
    const q = townOverpassQuery(51.2093, 3.2247)
    routeFetch({ overpass: 'ok' })
    const cold = await call(q, UA)
    expect(cold.status).toBe(503)
    expect(gaCalls + overpassCalls).toBe(0)
    store.set(keysOf(q).ga, { generator: 'geoapify', elements: [OVERPASS_BODY.elements[0]] })
    const warm = await call(q, UA)
    expect(warm.status).toBe(200)
    expect(warm.body.elements).toHaveLength(1)
    expect(gaCalls + overpassCalls).toBe(0)
  })

  it('single flight: five visitors on one cold tile make one GeoApify fallback (3 requests), all get places', async () => {
    routeFetch({ overpass: 'hang' })
    const outs = await Promise.all(Array.from({ length: 5 }, () => call(SYDNEY())))
    expect(outs.every(o => o.status === 200 && o.body.elements.length === 2)).toBe(true)
    expect(gaCalls).toBe(3)
    expect(overpassCalls).toBe(1)
  })

  it('hard ceiling under concurrency: 20 different cold tiles at 2,380 never take the day past 2,400', async () => {
    counters.set(creditKey(), 2380)
    routeFetch({ overpass: 'fail' })
    const tiles = Array.from({ length: 20 }, (_, i) => buildDiscoverOverpassQuery(-33.8688 + i * 0.1, 151.2093, 5000, null).query)
    await Promise.all(tiles.map(q => call(q)))
    await Promise.all(background)
    expect(gaCalls).toBeLessThanOrEqual(9) // at most 3 fallbacks of 3 requests
    expect(counters.get(creditKey())).toBeLessThanOrEqual(2400)
  })

  it('a GeoApify call that times out is charged its full worst case', async () => {
    routeFetch({ overpass: 'hang', geoapify: 'hang' })
    const pending = call(SYDNEY())
    await new Promise(r => setTimeout(r, 2700)) // past GEOAPIFY_TIMEOUT_MS
    await settle()
    expect(counters.get(creditKey())).toBe(6)
    overpassRelease()
    expect((await pending).body).toEqual(OVERPASS_BODY)
  }, 10000)

  // Regression (critic P1): an empty or failed GeoApify answer was not remembered, so every visit spent again
  it('a GeoApify answer with nothing usable is remembered: 5 visits spend credits once', async () => {
    routeFetch({ overpass: 'fail', geoapify: [] })
    for (let i = 0; i < 5; i++) {
      expect((await call(SYDNEY())).status).toBe(503)
      await settle()
    }
    expect(gaCalls).toBe(3) // one fallback (3 groups), on the first visit only
    expect(counters.get(creditKey())).toBe(3)
    expect(store.get(`overpass:ganone:${sha(snapQueryBbox(SYDNEY()))}`)).toBe(1)
    expect(cacheSet.mock.calls.find(c => c[0].startsWith('overpass:ganone:'))[2]).toBe(45 * 60)
  })

  // Regression (critic P1b): one IP sweeping 50 tiles spent 150 credits
  it('per-IP allowance: one IP gets 30 GeoApify fallbacks a day, then none; another IP still does', async () => {
    routeFetch({ overpass: 'fail' })
    const ipHeaders = { 'x-forwarded-for': '203.0.113.7' }
    const tiles = Array.from({ length: 32 }, (_, i) => buildDiscoverOverpassQuery(-30 - i * 0.2, 150, 5000, null).query)
    const outs = []
    for (const q of tiles) outs.push(await call(q, ipHeaders))
    expect(outs.filter(o => o.headers['x-overpass-fallback'] === 'geoapify')).toHaveLength(30)
    expect(gaCalls).toBe(90)
    expect(placesLines(log).at(-1)).toMatchObject({ ga_ip_capped: true })
    await settle()
    expect(counters.get(creditKey())).toBe(90) // refused visits reserved nothing globally
    const other = await call(buildDiscoverOverpassQuery(-10, 150, 5000, null).query, { 'x-forwarded-for': '198.51.100.9' })
    expect(other.headers['x-overpass-fallback']).toBe('geoapify')
  })

  it('a visit the global cap refuses does not use up the visitor\'s own allowance', async () => {
    counters.set(creditKey(), 2400)
    routeFetch({ overpass: 'ok' })
    await call(SYDNEY(), { 'x-forwarded-for': '203.0.113.50' })
    await settle()
    const ipKey = `geoapify:ip:${new Date().toISOString().slice(0, 10)}:203.0.113.50`
    expect(counters.get(ipKey)).toBe(0)
    expect(gaCalls).toBe(0)
  })

  // Regression (critic P5): a failing tile re-fired Overpass for every visitor
  it('back-off: 10 visitors on a stale tile while Overpass 429s make one refresh attempt, then none for 5 min', async () => {
    const k = keysOf(SYDNEY())
    store.set(k.stale, STALE_BODY)
    routeFetch({ overpass: 'fail' })
    for (let i = 0; i < 10; i++) {
      expect((await call(SYDNEY())).body.elements[0].tags.name).toBe('Stale Cafe')
      await settle()
    }
    expect(overpassCalls).toBe(2) // one fetch: both mirrors once
    const backoff = kvClient.set.mock.calls.find(c => c[0] === `overpass:backoff:${sha(snapQueryBbox(SYDNEY()))}`)
    expect(backoff[2]).toEqual({ ex: 300 })
    // Once it expires, the next visitor refreshes again
    locks.delete(backoff[0])
    await call(SYDNEY())
    await settle()
    expect(overpassCalls).toBe(4)
  })

  it('back-off after a non-429 failure is 2 min, and a cold visitor in back-off gets a quick 503 without Overpass', async () => {
    kvClient.set.mockClear()
    routeFetch({ overpass: 'fail', geoapify: 'fail' })
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (String(url).includes('geoapify')) { gaCalls++; return { ok: false, status: 500, json: async () => ({}) } }
      overpassCalls++
      return { ok: false, status: 504, text: async () => '' }
    }))
    expect((await call(SYDNEY())).status).toBe(503)
    await settle()
    const backoff = kvClient.set.mock.calls.find(c => String(c[0]).startsWith('overpass:backoff:'))
    expect(backoff[2]).toEqual({ ex: 120 })
    const before = overpassCalls
    const t = Date.now()
    expect((await call(SYDNEY())).status).toBe(503)
    expect(Date.now() - t).toBeLessThan(1500)
    expect(overpassCalls).toBe(before)
  })

  // Critic round 3 #4 (P2): back-off checked before the claim let a fetch through if a peer failed in between
  it('the lock is claimed before the back-off is read: a peer failing just before our claim stops our fetch', async () => {
    const q = SYDNEY()
    const k = keysOf(q)
    const bk = `overpass:backoff:${sha(snapQueryBbox(q))}`
    store.set(k.stale, STALE_BODY)
    locks.add(k.lock) // a peer is fetching
    routeFetch({ overpass: 'ok' })
    const setImpl = kvClient.set.getMockImplementation()
    kvClient.set.mockImplementation(async (key, v, opts) => {
      // The peer's fetch fails right now: back-off written, then its lock released
      if (opts?.nx && key === k.lock && !locks.has(bk)) { locks.add(bk); locks.delete(k.lock) }
      return setImpl(key, v, opts)
    })
    try {
      await call(q)
      await settle()
      await Promise.all(background)
      await settle()
    } finally {
      kvClient.set.mockImplementation(setImpl)
    }
    expect(overpassCalls).toBe(0)
    expect(locks.has(k.lock)).toBe(false) // claimed, saw the back-off, released
  })

  it('a cold visitor who claims the lock during a back-off releases it and makes no Overpass call', async () => {
    const bk = `overpass:backoff:${sha(snapQueryBbox(SYDNEY()))}`
    locks.add(bk)
    routeFetch({ overpass: 'ok' })
    const out = await call(SYDNEY())
    expect(out.headers['x-overpass-fallback']).toBe('geoapify')
    expect(overpassCalls).toBe(0)
    await settle()
    expect(locks.has(keysOf(SYDNEY()).lock)).toBe(false)
    expect(placesLines(log)[0]).toMatchObject({ overpass_backoff: true })
  })

  // Critic round 3 #5 (P3): a tile too big for KV was refetched from Overpass on every visit
  it('a fresh copy KV refuses (too big) backs the tile off for 30 min: 5 visits, one Overpass fetch', async () => {
    const q = SYDNEY()
    const k = keysOf(q)
    store.set(k.ga, { generator: 'geoapify', elements: OVERPASS_BODY.elements })
    routeFetch({ overpass: 'ok' })
    kvClient.set.mockClear()
    cacheSet.mockImplementation(async (key, value) => {
      if (key.startsWith('overpass:') && !key.startsWith('overpass:ga')) return false
      store.set(key, value)
      return true
    })
    try {
      for (let i = 0; i < 5; i++) {
        await call(q)
        await settle()
        await Promise.all(background)
        await settle()
      }
    } finally {
      cacheSet.mockImplementation(async (key, value) => { store.set(key, value); return true })
    }
    expect(overpassCalls).toBe(1)
    const backoff = kvClient.set.mock.calls.find(c => String(c[0]).startsWith('overpass:backoff:'))
    expect(backoff[2]).toEqual({ ex: 30 * 60 })
  })

  it('a failure after an Overpass 429 says so in a header (the prewarm cron reads it)', async () => {
    routeFetch({ overpass: 'fail', geoapify: 'fail' })
    const out = await call(SYDNEY())
    expect(out.status).toBe(503)
    expect(out.headers['x-overpass-upstream']).toBe('rate-limited')
  })

  it('cron warm, Overpass 429s, a stale copy exists: 200 from the stale copy, still flagged rate-limited', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    store.set(keysOf(SYDNEY()).stale, STALE_BODY)
    routeFetch({ overpass: 'fail' })
    const out = await call(SYDNEY(), { authorization: 'Bearer cron-secret' })
    expect(out.status).toBe(200)
    expect(out.headers['x-overpass-cache']).toBe('STALE')
    expect(out.headers['x-overpass-upstream']).toBe('rate-limited')
  })

  it('cron warm, a 429 then a mirror\'s empty 200: the empty answer is flagged rate-limited too', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => (n++ === 0
      ? { ok: false, status: 429, text: async () => '' }
      : okJson({ elements: [], remark: 'runtime error: Query timed out' }))))
    const out = await call(SYDNEY(), { authorization: 'Bearer cron-secret' })
    expect(out.status).toBe(200)
    expect(out.headers['x-overpass-cache']).toBe('EMPTY')
    expect(out.headers['x-overpass-upstream']).toBe('rate-limited')
  })

  // Critic round 4 #4: a tile Overpass never answers was retried every 2 min all day
  it('the back-off doubles from 2 min per failure in a row, capped at 1 h; a 429 is never under 5 min', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(n => backoffSeconds(n, false))).toEqual([120, 240, 480, 960, 1920, 3600, 3600, 3600])
    expect([1, 2, 3, 6, 20].map(n => backoffSeconds(n, true))).toEqual([300, 300, 480, 3600, 3600])
  })

  it('a tile that keeps failing backs off longer each time, and a success starts it from 2 min again', async () => {
    const h = sha(snapQueryBbox(SYDNEY()))
    const bk = `overpass:backoff:${h}`
    const fail504 = vi.fn(async url => (String(url).includes('geoapify') ? { ok: false, status: 400, json: async () => ({}) } : { ok: false, status: 504, text: async () => '' }))
    const lastBackoff = () => kvClient.set.mock.calls.filter(c => c[0] === bk).at(-1)[2].ex
    kvClient.set.mockClear()
    const seen = []
    for (let i = 0; i < 3; i++) {
      vi.stubGlobal('fetch', fail504)
      await call(SYDNEY())
      await settle()
      seen.push(lastBackoff())
      locks.delete(bk) // the back-off expires
      store.delete(`overpass:ganone:${h}`)
    }
    expect(seen).toEqual([120, 240, 480])
    expect(counters.get(`overpass:backoffn:${h}`)).toBe(3)
    routeFetch({ overpass: 'ok' })
    await call(SYDNEY())
    await Promise.all(background)
    await settle()
    expect(counters.has(`overpass:backoffn:${h}`)).toBe(false) // cleared by the success
    store.clear() // drop the fresh copy so the next visit fetches again
    vi.stubGlobal('fetch', fail504)
    await call(SYDNEY())
    await settle()
    expect(lastBackoff()).toBe(120)
  })

  it('GB keeps releasing the lock at once after a failure (no back-off)', async () => {
    kvClient.set.mockClear()
    routeFetch({ overpass: 'fail' })
    await call(LONDON())
    await settle()
    expect(kvClient.set.mock.calls.some(c => String(c[0]).startsWith('overpass:backoff:'))).toBe(false)
    expect(locks.size).toBe(0)
  })

  it('when Overpass wins, the GeoApify tail (refund, copy, lock release) is still kept alive with waitUntil', async () => {
    gaRelease = null
    routeFetch({ overpass: 'ok', geoapify: 'held' })
    const out = await call(SYDNEY())
    expect(out.headers['x-overpass-cache']).toBe('MISS')
    let done = false
    Promise.all(background).then(() => { done = true })
    await settle()
    expect(done).toBe(false) // the GeoApify tail is among the background work
    gaRelease()
    await settle()
    expect(done).toBe(true)
    expect(counters.get(creditKey())).toBe(3) // refunded to what was spent
  })

  it('KV not provisioned: no GeoApify attempt at all, and no wait for one', async () => {
    kvOff = true
    try {
      routeFetch({ overpass: 'fail' })
      const t = Date.now()
      const out = await call(SYDNEY())
      expect(out.status).toBe(503) // as before: Overpass failed and there is no copy
      expect(Date.now() - t).toBeLessThan(1000)
      expect(gaCalls).toBe(0)
    } finally {
      kvOff = false
    }
  })

  it('KV can\'t count: no GeoApify call (fails closed), Overpass as before', async () => {
    kvClient.incrby.mockRejectedValueOnce(new Error('down'))
    routeFetch({ overpass: 'ok' })
    const out = await call(SYDNEY())
    expect(out.body).toEqual(OVERPASS_BODY)
    expect(gaCalls).toBe(0)
  })

  it('a visitor who lost the fetch lock gets GeoApify instead of waiting 6 s for the peer', async () => {
    locks.add(keysOf(SYDNEY()).lock)
    routeFetch({ overpass: 'ok' })
    const t = Date.now()
    const out = await call(SYDNEY())
    expect(out.headers['x-overpass-fallback']).toBe('geoapify')
    expect(Date.now() - t).toBeLessThan(500)
    expect(overpassCalls).toBe(0) // the peer is fetching
  })
})

describe('overpass nearby: the POI DB step and its region', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock('../../../api/lib/poiQuery.js'); vi.doUnmock('../../../api/lib/flags.js'); vi.resetModules(); delete process.env.GEOAPIFY_API_KEY })

  // A fresh handler whose POI rollout is fully on, with getPois mocked
  async function withDb(getPois) {
    vi.resetModules()
    const flags = { poiDbPct: 100, poiShadowPct: 0, poiCapPct: 100 }
    vi.doMock('../../../api/lib/flags.js', () => ({ isFeatureEnabled: async () => true, peekFlags: () => flags, getFlags: async () => flags }))
    vi.doMock('../../../api/lib/poiQuery.js', async orig => ({ ...(await orig()), getPois, peekPoiGen: () => 1, getPoiGen: async () => 1, poiSlotBusy: () => false }))
    const { default: fresh } = await import('../../../api/places/overpass/nearby.js')
    store.clear(); counters.clear(); locks = new Set()
    process.env.GEOAPIFY_API_KEY = 'k'
    return q => new Promise(resolve => {
      const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v }, status(c) { this.statusCode = c; return this }, json(body) { resolve({ status: this.statusCode, headers: this.headers, body }); return this } }
      fresh({ method: 'POST', headers: { 'x-forwarded-for': `10.2.0.${++ip}` }, body: typeof q === 'string' ? { query: q } : q, socket: {} }, res)
    })
  }

  it('is skipped outside the region (it cannot cover the tile; a cold coverage load would eat the first-visit budget)', async () => {
    const getPois = vi.fn(() => new Promise(() => {}))
    const run = await withDb(getPois)
    routeFetch({ overpass: 'hang' })
    const t = Date.now()
    const out = await run(SYDNEY())
    expect(out.headers['x-overpass-fallback']).toBe('geoapify')
    expect(Date.now() - t).toBeLessThan(500)
    expect(getPois).not.toHaveBeenCalled()
  })

  // Regression (critic F1): the old query box stopped at -8.7, so Ireland's west coast skipped the DB
  it.each([
    ['London', 51.5074, -0.1278],
    ['Galway', 53.2707, -9.0568],
    ['Killarney', 52.0599, -9.5044],
    ['Dingle', 52.1408, -10.2686],
    ['Scilly', 49.9147, -6.3150],
  ])('%s is answered by the DB, never GeoApify', async (_name, lat, lng) => {
    const getPois = vi.fn(async () => ({ n: 1, body: JSON.stringify(OVERPASS_BODY), buildId: 'b1' }))
    const run = await withDb(getPois)
    routeFetch({ overpass: 'hang' })
    const out = await run(buildDiscoverOverpassQuery(lat, lng, 5000, null).query)
    expect(out.headers['x-places-source']).toBe('db')
    expect(getPois).toHaveBeenCalled()
    expect(gaCalls).toBe(0)
  })

  const dogsAt = (lat, lng) => ({ query: buildDiscoverOverpassQuery(lat, lng, 5000, null).query, dogs: true, lat, lng, radius: 5000 })

  // Critic round 3 #2: DB-served bodies never merge dogs, yet the dog fetch spent 3 credits on each
  it('a DB-served dog request starts no dog fetch and reserves nothing', async () => {
    const run = await withDb(vi.fn(async () => ({ n: 1, body: JSON.stringify(OVERPASS_BODY), buildId: 'b1' })))
    routeFetch({ overpass: 'hang' })
    const out = await run(dogsAt(51.5074, -0.1278))
    expect(out.headers['x-places-source']).toBe('db')
    await settle()
    expect(gaCalls).toBe(0)
    expect(counters.size).toBe(0)
  })

  // Critic round 4 #2: the dog fetch had moved after the whole DB step, so a slow DB miss plus an
  // uncached dog fetch was serial and could pass the app's 8 s timeout
  it('slow DB miss: the dog cache read starts at once and the dog call overlaps the DB wait', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    try {
      // The DB takes 3 s to say "not here" (a cold coverage read, a killed statement)
      const run = await withDb(vi.fn(() => new Promise(r => setTimeout(() => r(null), 3000))))
      routeFetch({ overpass: 'ok' })
      cacheGet.mockClear()
      const pending = run(dogsAt(51.5074, -0.1278))
      await vi.advanceTimersByTimeAsync(10)
      expect(cacheGet.mock.calls.some(c => String(c[0]).startsWith('geoapify:dogs:'))).toBe(true) // at t0
      expect(gaCalls).toBe(0) // nothing paid before the DB's first wait is over
      await vi.advanceTimersByTimeAsync(1100) // past POI_DEADLINE_MS (1 s), DB still out
      expect(gaCalls).toBe(1) // the dog call is already in flight
      await vi.advanceTimersByTimeAsync(10000)
      const out = await pending
      expect(out.status).toBe(200)
      expect(gaCalls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  // Critic round 5 #1: a DB that answers after its first wait leaves a started dog call unused;
  // the places log says so (dogs_started) so production can measure how often
  it('logs dogs_started when the DB answers after its first wait', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    const logs = []
    const spy = vi.spyOn(console, 'log').mockImplementation(l => { logs.push(String(l)) })
    try {
      const run = await withDb(vi.fn(() => new Promise(r => setTimeout(() => r({ n: 1, body: JSON.stringify(OVERPASS_BODY), buildId: 'b1' }), 1500))))
      routeFetch({ overpass: 'hang' })
      const pending = run(dogsAt(51.5074, -0.1278))
      await vi.advanceTimersByTimeAsync(5000)
      const out = await pending
      expect(out.headers['x-places-source']).toBe('db')
      const line = logs.map(l => { try { return JSON.parse(l) } catch { return null } }).find(l => l?.evt === 'places' && l.src === 'db')
      expect(line?.dogs_started).toBe(true)
    } finally {
      spy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('when the DB can\'t answer, the dog fetch still runs and merges as before', async () => {
    const run = await withDb(vi.fn(async () => null))
    routeFetch({ overpass: 'ok' })
    const out = await run(dogsAt(51.5074, -0.1278))
    expect(out.body.elements[0]).toEqual(OVERPASS_BODY.elements[0])
    expect(gaCalls).toBe(1) // the dog call
    expect(counters.get(creditKey())).toBe(3)
  })
})

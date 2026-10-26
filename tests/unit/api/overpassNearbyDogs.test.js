import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildDiscoverOverpassQuery } from '../../../shared/overpassQuery.js'

const store = new Map()
// Dog mode reserves GeoApify credits in KV before calling (api/lib/geoapify.js): a counter is needed
const counters = new Map()
let kvClient
const makeClient = () => ({
  set: async () => 'OK', del: async () => 1, exists: async () => 0,
  get: async k => counters.get(k) ?? null,
  incrby: async (k, n) => { counters.set(k, (counters.get(k) || 0) + n); return counters.get(k) },
  decrby: async (k, n) => { counters.set(k, (counters.get(k) || 0) - n); return counters.get(k) },
  expire: async () => 1,
  pipeline: () => ({ incr() { return this }, expire() { return this }, exec: async () => [1, 1] }),
})
const creditKey = () => `geoapify:credits:${new Date().toISOString().slice(0, 10)}`
const cacheGet = vi.fn(async key => store.get(key) ?? null)
const cacheSet = vi.fn(async (key, value) => { store.set(key, value); return true })
vi.mock('../../../api/lib/kvCache.js', async () => {
  const { createHash } = await import('node:crypto')
  return {
    cacheGet: (...a) => cacheGet(...a),
    cacheSet: (...a) => cacheSet(...a),
    hashKey: v => createHash('sha1').update(v).digest('hex'),
    isCacheEnabled: () => true,
    getClient: () => kvClient
  }
})
vi.mock('../../../api/lib/flags.js', () => ({ isFeatureEnabled: async () => true }))
vi.mock('@vercel/functions', () => ({ waitUntil: p => p }))

const { default: handler } = await import('../../../api/places/overpass/nearby.js')

const ELEMENTS = { elements: [{ type: 'node', id: 1, lat: 51.5, lon: -0.12, tags: { name: 'Cafe', amenity: 'cafe' } }] }
// One GeoApify feature at coords 900 m from the Overpass element: NOT a dupe.
const DOG_FEATURES = { features: [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-0.13, 51.51] },
    properties: { name: 'Doggy Diner', place_id: 'd1', categories: ['catering.restaurant', 'dogs.yes'] } },
]}
const DUP_DOG_FEATURES = { features: [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-0.12001, 51.50004] },
    properties: { name: 'Same Cafe', place_id: 'd2', categories: ['catering.cafe', 'dogs.yes'] } },
]}

let ip = 0
function call(body) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v },
      status(c) { this.statusCode = c; return this },
      json(b) { resolve({ status: this.statusCode, headers: this.headers, body: b }); return this },
      end() { resolve({ status: this.statusCode, headers: this.headers }); return this }
    }
    handler({ method: 'POST', headers: { 'x-forwarded-for': `10.0.0.${++ip}` }, body, socket: {} }, res)
  })
}

function callFrom(ipAddr, body) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v },
      status(c) { this.statusCode = c; return this },
      json(b) { resolve({ status: this.statusCode, headers: this.headers, body: b }); return this },
      end() { resolve({ status: this.statusCode, headers: this.headers }); return this }
    }
    handler({ method: 'POST', headers: { 'x-forwarded-for': ipAddr }, body, socket: {} }, res)
  })
}

function dogBody() {
  const query = buildDiscoverOverpassQuery(51.5, -0.12, 5000, null).query
  return { query, dogs: true, lat: 51.5, lng: -0.12, radius: 5000, category: null }
}

// Split the two upstreams by URL: GeoApify gets features, Overpass gets the tile.
function splitFetch(geoapify) {
  return vi.fn(async url => url.includes('geoapify')
    ? geoapify
    : { ok: true, status: 200, json: async () => ELEMENTS })
}

describe('overpass nearby: dog-friendly merge', () => {
  let fetchMock
  beforeEach(() => {
    store.clear()
    counters.clear()
    kvClient = makeClient()
    cacheGet.mockClear()
    cacheSet.mockClear()
    vi.stubEnv('GEOAPIFY_API_KEY', 'test-key')
    fetchMock = splitFetch({ ok: true, status: 200, json: async () => DOG_FEATURES })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  const geoapifyCalls = () => fetchMock.mock.calls.filter(c => c[0].includes('geoapify')).length
  const overpassCalls = () => fetchMock.mock.calls.filter(c => !c[0].includes('geoapify')).length

  it('merges the dog places into a fresh Overpass answer, and the tile cache stays pure Overpass', async () => {
    const out = await call(dogBody())
    expect(out.status).toBe(200)
    expect(out.body.elements).toHaveLength(2)
    expect(out.body.elements[1]).toMatchObject({ id: 'ga-d1', lat: 51.51, lon: -0.13 })
    expect(out.body.elements[1].tags).toEqual({ name: 'Doggy Diner', amenity: 'restaurant', dog: 'yes' })

    // The 24h tile entry is the plain Overpass body (dog and non-dog users share it);
    // the dog answer lives under its own geoapify:dogs: key
    // (a failed condition must not pin the other condition's answer for 24h).
    const tileWrite = cacheSet.mock.calls.find(c => c[0].startsWith('overpass:') && !c[0].includes('stale'))
    expect(tileWrite[1]).toEqual(ELEMENTS)
    const dogWrites = cacheSet.mock.calls.filter(c => c[0].startsWith('geoapify:dogs:'))
    expect(dogWrites).toHaveLength(1)
    expect(dogWrites[0][0]).toBe('geoapify:dogs:51.5:-0.12:5000:all')
    expect(dogWrites[0][1]).toHaveLength(1)
  })

  it('a failed condition is not cached, so the next caller retries it', async () => {
    const f = vi.fn(async url => {
      if (!url.includes('geoapify')) return { ok: true, status: 200, json: async () => ELEMENTS }
      return Promise.reject(new Error('timeout'))
    })
    vi.stubGlobal('fetch', f)

    const first = await call(dogBody())
    expect(first.body.elements).toHaveLength(1) // pure Overpass; the dog condition failed
    expect(cacheSet.mock.calls.every(c => !c[0].startsWith('geoapify:'))).toBe(true)

    const second = await call(dogBody())
    expect(second.body.elements).toHaveLength(1)
    // the failed condition is retried on the next caller
    expect(f.mock.calls.filter(c => c[0].includes('geoapify'))).toHaveLength(2)
  })

  it('fires one request per dog condition (the conditions array is AND-ed server-side)', async () => {
    const out = await call(dogBody())
    expect(out.status).toBe(200)
    const bodies = fetchMock.mock.calls
      .filter(c => c[0].includes('geoapify'))
      .map(c => JSON.parse(c[1].body).conditions)
    // dogs.yes only: leashed measured 20s / 0 features live, not worth the stall
    expect(bodies).toEqual([['dogs.yes']])
  })

  it('dedupes a GeoApify place that lands on an Overpass element (same ~11 m cell)', async () => {
    fetchMock = splitFetch({ ok: true, status: 200, json: async () => DUP_DOG_FEATURES })
    vi.stubGlobal('fetch', fetchMock)
    const out = await call(dogBody())
    expect(out.status).toBe(200)
    expect(out.body.elements).toHaveLength(1) // the Overpass cafe, not a duplicate
    expect(out.body.elements[0].id).toBe(1)
  })

  it('merges on a KV tile HIT with zero Overpass calls, and caches the dog answer for the next caller', async () => {
    const { createHash } = await import('node:crypto')
    const { snapQueryBbox } = await import('../../../api/lib/bboxSnap.js')
    const q = buildDiscoverOverpassQuery(51.5, -0.12, 5000, null).query
    store.set(`overpass:${createHash('sha1').update(snapQueryBbox(q)).digest('hex')}`, ELEMENTS)

    const out = await call(dogBody())
    expect(out.status).toBe(200)
    expect(out.headers['x-overpass-cache']).toBe('HIT')
    expect(out.body.elements).toHaveLength(2)
    expect(overpassCalls()).toBe(0) // the tile came from KV
    expect(geoapifyCalls()).toBe(1) // one request per dog condition

    // Second caller: the merged answer comes from the dog cache, GeoApify is not re-called
    const second = await call(dogBody())
    expect(second.body.elements).toHaveLength(2)
    expect(geoapifyCalls()).toBe(1)
    expect(overpassCalls()).toBe(0)
  })

  it('with Overpass fully down and no stale copy, serves the dog deck alone (fallback: geoapify)', async () => {
    fetchMock = splitFetch({ ok: true, status: 200, json: async () => DOG_FEATURES })
    vi.stubGlobal('fetch', vi.fn(async url => url.includes('geoapify')
      ? { ok: true, status: 200, json: async () => DOG_FEATURES }
      : { ok: false, status: 504, text: async () => '' }))
    const out = await call(dogBody())
    expect(out.status).toBe(200)
    expect(out.headers['x-overpass-fallback']).toBe('geoapify')
    expect(out.body.elements).toHaveLength(1)
    expect(out.body.elements[0].tags.dog).toBe('yes')
  })

  it('a genuine empty GeoApify answer is not cached (the rate limit also returns 200+empty)', async () => {
    fetchMock = splitFetch({ ok: true, status: 200, json: async () => ({ features: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    const out = await call(dogBody())
    expect(out.status).toBe(200)
    expect(out.body.elements).toHaveLength(1) // pure Overpass
    expect(cacheSet.mock.calls.every(c => !c[0].startsWith('geoapify:'))).toBe(true)
  })

  it('a GeoApify 429 leaves the Overpass answer untouched and caches nothing under the dog key', async () => {
    fetchMock = splitFetch({ ok: false, status: 429, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)
    const out = await call(dogBody())
    expect(out.status).toBe(200)
    expect(out.body.elements).toHaveLength(1) // pure Overpass
    expect(out.body.elements[0].id).toBe(1)
    expect(cacheSet.mock.calls.every(c => !c[0].startsWith('geoapify:'))).toBe(true)
  })

  it('without GEOAPIFY_API_KEY the dogs flag is inert: no GeoApify call, plain Overpass body', async () => {
    vi.stubEnv('GEOAPIFY_API_KEY', '')
    const out = await call(dogBody())
    expect(out.status).toBe(200)
    expect(out.body.elements).toEqual(ELEMENTS.elements)
    expect(geoapifyCalls()).toBe(0)
    expect(overpassCalls()).toBe(1)
  })

  // Regression (critic M15): dog calls spend the same free-tier credits and must be counted
  it('reserves 3 credits per dog call on the shared daily counter', async () => {
    await call(dogBody())
    expect(geoapifyCalls()).toBe(1)
    expect(counters.get(creditKey())).toBe(3)
  })

  it('respects the hard ceiling: at 2,798 a dog call (3) would pass 2,800, so none is made and the count is rolled back', async () => {
    counters.set(creditKey(), 2798)
    const out = await call(dogBody())
    expect(out.status).toBe(200)
    expect(out.body.elements).toEqual(ELEMENTS.elements) // plain Overpass deck
    expect(geoapifyCalls()).toBe(0)
    expect(counters.get(creditKey())).toBe(2798)
  })

  it('may use the 2,400-2,800 band the places fallback leaves it', async () => {
    counters.set(creditKey(), 2500)
    await call(dogBody())
    expect(geoapifyCalls()).toBe(1)
    expect(counters.get(creditKey())).toBe(2503)
  })

  // Regression (critic round 3 P1): one IP varying lat drained the shared credits through dog mode
  it('one IP gets 40 dog calls a day; the 41st+ make none and reserve nothing; another IP still can', async () => {
    const out = []
    for (let i = 0; i < 45; i++) {
      out.push(await callFrom('203.0.113.7', { ...dogBody(), lat: 51.5 + i * 0.001 }))
    }
    expect(out.every(o => o.status === 200)).toBe(true)
    expect(geoapifyCalls()).toBe(40)
    expect(counters.get(creditKey())).toBe(120) // 40 x 3, not 45 x 3
    await callFrom('198.51.100.9', { ...dogBody(), lat: 51.7 })
    expect(geoapifyCalls()).toBe(41)
  })

  it('a dog call the global cap refuses does not use up the visitor\'s dog allowance', async () => {
    counters.set(creditKey(), 2798)
    await callFrom('203.0.113.8', dogBody())
    const ipKey = `geoapify:ipdogs:${new Date().toISOString().slice(0, 10)}:203.0.113.8`
    expect(counters.get(ipKey)).toBe(0)
    expect(geoapifyCalls()).toBe(0)
  })

  it('KV unavailable: no reservation, no dog call (fails closed)', async () => {
    kvClient = null
    const out = await call(dogBody())
    expect(out.status).toBe(200)
    expect(geoapifyCalls()).toBe(0)
  })

  it('the dog fetch runs alongside the Overpass attempt, not after it', async () => {
    let release
    fetchMock = vi.fn(url => (url.includes('geoapify')
      ? Promise.resolve({ ok: true, status: 200, json: async () => DOG_FEATURES })
      : new Promise(r => { release = () => r({ ok: true, status: 200, json: async () => ELEMENTS }) })))
    vi.stubGlobal('fetch', fetchMock)
    const pending = call(dogBody())
    await new Promise(r => setTimeout(r, 20))
    expect(geoapifyCalls()).toBe(1) // already asked while Overpass is still out
    release()
    expect((await pending).body.elements).toHaveLength(2)
  })

  it('a non-dog request never touches GeoApify', async () => {
    const out = await call({ query: dogBody().query })
    expect(out.status).toBe(200)
    expect(out.body.elements).toEqual(ELEMENTS.elements)
    expect(geoapifyCalls()).toBe(0)
  })
})

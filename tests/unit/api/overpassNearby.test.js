import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildDiscoverOverpassQuery } from '../../../shared/overpassQuery.js'

const store = new Map()
let kvClient = null
const cacheGet = vi.fn(async key => store.get(key) ?? null)
const cacheSet = vi.fn(async (key, value) => { store.set(key, value); return true })
vi.mock('../../../api/lib/kvCache.js', async () => {
  const { createHash } = await import('node:crypto')
  return {
    cacheGet: (...a) => cacheGet(...a),
    cacheSet: (...a) => cacheSet(...a),
    hashKey: v => createHash('sha1').update(v).digest('hex'),
    isCacheEnabled: () => true,
    getClient: () => kvClient // shared limiter; null = fails open
  }
})
vi.mock('../../../api/lib/flags.js', () => ({ isFeatureEnabled: async () => true }))
vi.mock('@vercel/functions', () => ({ waitUntil: p => p }))

const { default: handler } = await import('../../../api/places/overpass/nearby.js')

const ELEMENTS = { elements: [{ type: 'node', id: 1, lat: 51.5, lon: -0.12, tags: { name: 'Cafe', amenity: 'cafe' } }] }
let ip = 0
function call(query) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v },
      status(c) { this.statusCode = c; return this },
      json(body) { resolve({ status: this.statusCode, headers: this.headers, body }); return this },
      end() { resolve({ status: this.statusCode, headers: this.headers }); return this }
    }
    handler({ method: 'POST', headers: { 'x-forwarded-for': `10.0.0.${++ip}` }, body: { query }, socket: {} }, res)
  })
}

describe('overpass nearby: grid-snapped cache key', () => {
  let fetchMock
  beforeEach(() => {
    store.clear()
    cacheGet.mockClear()
    cacheSet.mockClear()
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ELEMENTS }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('during an outage, serves a stale copy saved under the pre-snapping key', async () => {
    const { createHash } = await import('node:crypto')
    const query = buildDiscoverOverpassQuery(51.5074, -0.1278, 5000, null).query
    store.set(`overpass:stale:${createHash('sha1').update(query).digest('hex')}`, ELEMENTS)
    fetchMock.mockImplementation(async () => ({ ok: false, status: 504, text: async () => '' }))
    const out = await call(query)
    expect(out.status).toBe(200)
    expect(out.body.elements).toHaveLength(1)
  })

  it('two users a few metres apart share one cache entry (regression: raw coords never hit)', async () => {
    const a = buildDiscoverOverpassQuery(51.5074, -0.1278, 5000, null).query
    const b = buildDiscoverOverpassQuery(51.50745, -0.12785, 5000, null).query // ~7 m away
    expect(a).not.toBe(b)

    const first = await call(a)
    expect(first.headers['x-overpass-cache']).toBe('MISS')
    const second = await call(b)
    expect(second.headers['x-overpass-cache']).toBe('HIT')
    expect(second.body).toEqual(ELEMENTS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cacheGet.mock.calls[0][0]).toBe(cacheGet.mock.calls[1][0])
  })

  it('sends the snapped query upstream, so the cached body matches its key', async () => {
    const q = buildDiscoverOverpassQuery(51.5074, -0.1278, 5000, null).query
    await call(q)
    const sent = decodeURIComponent(fetchMock.mock.calls[0][1].body.replace(/^data=/, ''))
    expect(sent).not.toBe(q)
    expect(sent).toMatch(/\[bbox:51\.45\d+,-0\.2\d+,51\.5\d+,-0\.0\d+\]/)
  })

  it('keeps separate entries for towns far apart', async () => {
    await call(buildDiscoverOverpassQuery(51.5074, -0.1278, 5000, null).query)
    const other = await call(buildDiscoverOverpassQuery(53.4808, -2.2426, 5000, null).query)
    expect(other.headers['x-overpass-cache']).toBe('MISS')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('overpass nearby: shared rate limit', () => {
  afterEach(() => { kvClient = null; vi.unstubAllGlobals() })

  it('allows a busy shared IP (carrier NAT) up to 300/min', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, text: async () => '' })))
    const exec = vi.fn(async () => [120, 1])
    kvClient = { pipeline: () => ({ incr() { return this }, expire() { return this }, exec }), get: async () => null, set: async () => 'OK' }
    const out = await call(buildDiscoverOverpassQuery(51.5074, -0.1278, 5000, null).query)
    expect(out.status).not.toBe(429)
  })

  it('429s once the cross-instance count for this IP passes 300/min, before any upstream call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const exec = vi.fn(async () => [301, 1])
    kvClient = { pipeline: () => ({ incr() { return this }, expire() { return this }, exec }) }
    const out = await call(buildDiscoverOverpassQuery(51.5074, -0.1278, 5000, null).query)
    expect(out.status).toBe(429)
    expect(exec).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

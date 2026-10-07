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

  it('a busy Overpass 504 gets one retry, and the second answer is served (regression: New York town page 503s)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 504, text: async () => '' })
    const out = await call(buildDiscoverOverpassQuery(40.7128, -74.006, 3000, null).query)
    expect(out.status).toBe(200)
    expect(out.body.elements).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries at most once: an Overpass that keeps 504ing costs two calls, then 503', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 504, text: async () => '' }))
    const out = await call(buildDiscoverOverpassQuery(40.7128, -74.006, 3000, null).query)
    expect(out.status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a 429 is not retried: Overpass asked us to slow down', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 429, text: async () => '' }))
    const out = await call(buildDiscoverOverpassQuery(40.7128, -74.006, 3000, null).query)
    expect(out.status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(1)
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

describe('overpass nearby: single flight across instances', () => {
  let fetchMock, locks
  const lockClient = () => ({
    pipeline: () => ({ incr() { return this }, expire() { return this }, exec: async () => [1, 1] }),
    set: vi.fn(async (key, _v, opts) => {
      if (opts?.nx && locks.has(key)) return null
      locks.add(key)
      return 'OK'
    }),
    del: vi.fn(async key => { locks.delete(key); return 1 }),
    exists: vi.fn(async key => (locks.has(key) ? 1 : 0))
  })
  const query = () => buildDiscoverOverpassQuery(53.9600, -1.0873, 5000, null).query // York
  beforeEach(() => {
    store.clear()
    locks = new Set()
    kvClient = lockClient()
  })
  afterEach(() => { kvClient = null; vi.useRealTimers(); vi.unstubAllGlobals() })

  it('ten concurrent misses on one new tile make ONE upstream call; the rest get its answer', async () => {
    let release
    fetchMock = vi.fn(() => new Promise(r => { release = () => r({ ok: true, status: 200, json: async () => ELEMENTS }) }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = Array.from({ length: 10 }, () => call(query()))
    await new Promise(r => setTimeout(r, 50))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    release()
    const out = await Promise.all(pending)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(out.every(o => o.status === 200 && o.body.elements.length === 1)).toBe(true)
    expect(out.filter(o => o.headers['x-overpass-cache'] === 'PEER')).toHaveLength(9)
    await new Promise(r => setTimeout(r, 0))
    expect(locks.size).toBe(0)
  })

  it('the lock is released only after the fresh copy is written (no gap for a second upstream call)', async () => {
    let landWrite
    cacheSet.mockImplementationOnce(async (key, value) => { await new Promise(r => { landWrite = r }); store.set(key, value); return true })
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ELEMENTS }))
    vi.stubGlobal('fetch', fetchMock)
    expect((await call(query())).status).toBe(200)
    await new Promise(r => setTimeout(r, 10))
    expect(locks.size).toBe(1) // write still in flight: lock held
    landWrite()
    await new Promise(r => setTimeout(r, 10))
    expect(locks.size).toBe(0)
  })

  it('when the peer fails fast, waiters stop waiting at once (503 in well under a second, no second call)', async () => {
    let fail
    const r429 = { ok: false, status: 429, text: async () => '' }
    fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise(r => { fail = () => r(r429) })) // first endpoint: held until we fail it
      .mockImplementation(async () => r429) // second endpoint: fails at once
    vi.stubGlobal('fetch', fetchMock)
    const holder = call(query())
    await new Promise(r => setTimeout(r, 20))
    const t = Date.now()
    const waiter = call(query())
    await new Promise(r => setTimeout(r, 20))
    fail()
    const [, w] = await Promise.all([holder, waiter])
    expect(w.status).toBe(503)
    expect(Date.now() - t).toBeLessThan(1500)
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2) // the holder's two endpoints, nothing from the waiter
  })

  it('a waiter with a last-known-good copy gets it at once, without waiting', async () => {
    const { createHash } = await import('node:crypto')
    const { snapQueryBbox } = await import('../../../api/lib/bboxSnap.js')
    const h = createHash('sha1').update(snapQueryBbox(query())).digest('hex')
    locks.add(`overpass:lock:${h}`)
    store.set(`overpass:stale:${h}`, ELEMENTS)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const t = Date.now()
    const out = await call(query())
    expect(out.status).toBe(200)
    expect(out.headers['x-overpass-fallback']).toBe('peer')
    expect(Date.now() - t).toBeLessThan(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a failed fetch releases the lock, so the next request retries upstream', async () => {
    fetchMock = vi.fn(async () => ({ ok: false, status: 504, text: async () => '' }))
    vi.stubGlobal('fetch', fetchMock)
    expect((await call(query())).status).toBe(503)
    await new Promise(r => setTimeout(r, 0))
    expect(locks.size).toBe(0)
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ELEMENTS }))
    expect((await call(query())).status).toBe(200)
  })

  it('a waiter whose peer is still fetching after 6 s gets last-known-good, else a quick 503, never a second upstream call', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    fetchMock = vi.fn(() => new Promise(() => {})) // the peer's fetch hangs
    vi.stubGlobal('fetch', fetchMock)
    const { createHash } = await import('node:crypto')
    const { snapQueryBbox } = await import('../../../api/lib/bboxSnap.js')
    const q = query()
    const h = createHash('sha1').update(snapQueryBbox(q)).digest('hex') // keys use the grid-snapped query
    locks.add(`overpass:lock:${h}`) // a peer holds the lock
    const noStale = call(q)
    await vi.advanceTimersByTimeAsync(6500)
    const out = await noStale
    expect(out.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
    store.set(`overpass:stale:${h}`, ELEMENTS)
    const withStale = call(q)
    await vi.advanceTimersByTimeAsync(6500)
    const out2 = await withStale
    expect(out2.status).toBe(200)
    expect(out2.headers['x-overpass-fallback']).toBe('peer')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('KV unavailable or erroring: fetches as before', async () => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ELEMENTS }))
    vi.stubGlobal('fetch', fetchMock)
    kvClient = { ...lockClient(), set: async () => { throw new Error('KV down') } }
    expect((await call(query())).status).toBe(200)
    store.clear()
    kvClient = null
    expect((await call(query())).status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

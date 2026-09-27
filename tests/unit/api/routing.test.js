import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// KV is "available" so a regression back to caching would show up here
const kv = vi.hoisted(() => ({ get: vi.fn(async () => null), set: vi.fn(async () => true) }))
vi.mock('../../../api/lib/kvCache.js', () => ({
  isCacheEnabled: () => true,
  getClient: () => ({}),
  cacheGet: kv.get,
  cacheSet: kv.set,
}))

import handler, { compactLine } from '../../../api/routing/index.js'

let n = 0
async function call(body) {
  const res = {
    statusCode: 200, headers: {},
    setHeader(k, v) { this.headers[k] = v },
    getHeader(k) { return this.headers[k] },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    end() { return this }
  }
  await handler({ method: 'POST', body, headers: { 'x-forwarded-for': `10.8.0.${n++}` } }, res)
  return res
}

// ORS GeoJSON: [lng, lat] pairs
const coords = (count) => Array.from({ length: count }, (_, i) => [-0.1 + i * 1e-4, 51.5 + i * 1e-4])
const orsOk = (count = 5) => vi.fn(async () => ({
  ok: true,
  json: async () => ({
    features: [{
      geometry: { coordinates: coords(count) },
      properties: { segments: [{ duration: 600, distance: 850 }] }
    }]
  })
}))

const from = { lat: 51.5, lng: -0.1 }
const to = { lat: 51.51, lng: -0.09 }

describe('POST /api/routing', () => {
  beforeEach(() => { vi.stubEnv('ORS_API_KEY', 'k'); kv.get.mockClear(); kv.set.mockClear() })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it('keeps the old response shape when geometry is not asked for (old builds)', async () => {
    vi.stubGlobal('fetch', orsOk())
    const res = await call({ from, to, mode: 'walk' })
    expect(res.body).toEqual({ duration: 10, distance: 0.85, source: 'api' })
  })

  it('keeps a long route response small', async () => {
    vi.stubGlobal('fetch', orsOk(5000))
    const res = await call({ from, to, mode: 'drive', geometry: true })
    expect(res.body.geometry.length).toBeLessThanOrEqual(200)
    expect(JSON.stringify(res.body).length).toBeLessThan(6000)
  })

  it('returns a [lat,lng] line when geometry: true', async () => {
    vi.stubGlobal('fetch', orsOk(5))
    const res = await call({ from, to, mode: 'drive', geometry: true })
    expect(res.body.geometry).toHaveLength(5)
    expect(res.body.geometry[0]).toEqual([51.5, -0.1])
    expect(res.body.geometry[4]).toEqual([51.5004, -0.0996])
    expect(fetchUrl()).toContain('/driving-car?')
  })

  it('never returns geometry for transit (no free transit routing)', async () => {
    vi.stubGlobal('fetch', orsOk())
    const res = await call({ from, to, mode: 'transit', geometry: true })
    expect(res.body.geometry).toBeUndefined()
    expect(res.body.source).toBe('api')
  })

  it('falls back to an estimate with no geometry when ORS fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => 'x' })))
    const res = await call({ from, to, mode: 'walk', geometry: true })
    expect(res.body.source).toBe('fallback')
    expect(res.body.geometry).toBeUndefined()
  })

  it('falls back with no geometry when ORS_API_KEY is missing', async () => {
    vi.stubEnv('ORS_API_KEY', '')
    const res = await call({ from, to, geometry: true })
    expect(res.body.source).toBe('fallback')
    expect(res.body.geometry).toBeUndefined()
  })

  it('never reads or writes KV (per-user origins give no hits, only quota burn)', async () => {
    vi.stubGlobal('fetch', orsOk())
    await call({ from, to, mode: 'walk', geometry: true })
    await call({ from, to, mode: 'walk' })
    expect(kv.get).not.toHaveBeenCalled()
    expect(kv.set).not.toHaveBeenCalled()
  })

  it('still validates coordinates', async () => {
    const res = await call({ from: { lat: 999, lng: 0 }, to, geometry: true })
    expect(res.statusCode).toBe(400)
  })

  function fetchUrl() { return globalThis.fetch.mock.calls[0][0] }
})

describe('compactLine', () => {
  it('caps long lines at 200 points and keeps both ends', () => {
    const line = compactLine(coords(4000))
    expect(line.length).toBeLessThanOrEqual(200)
    expect(line.length).toBeGreaterThan(190)
    expect(line[0]).toEqual([51.5, -0.1])
    expect(line.at(-1)).toEqual([51.8999, 0.2999])
  })

  it('rounds to 5dp', () => {
    expect(compactLine([[-0.123456789, 51.987654321], [0, 0]])[0]).toEqual([51.98765, -0.12346])
  })

  it('returns null without a usable line', () => {
    expect(compactLine(undefined)).toBeNull()
    expect(compactLine([[0, 0]])).toBeNull()
  })
})

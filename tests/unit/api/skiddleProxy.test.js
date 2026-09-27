import { describe, it, expect, vi, afterEach } from 'vitest'
import handler from '../../../api/events/skiddle.js'

let n = 0
async function call(query = { lat: '53.96', lng: '-1.08' }) {
  const res = {
    statusCode: 200, headers: {},
    setHeader(k, v) { this.headers[k] = v },
    getHeader(k) { return this.headers[k] },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    end() { return this }
  }
  await handler({ method: 'GET', query, headers: { 'x-forwarded-for': `10.8.0.${n++}` } }, res)
  return res
}

describe('Skiddle proxy edge caching', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('caches a good listing for 15 minutes', async () => {
    vi.stubEnv('SKIDDLE_KEY', 'k')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ results: [{ id: 1 }] }) })))
    const res = await call()
    expect(res.statusCode).toBe(200)
    expect(res.headers['Cache-Control']).toBe('public, s-maxage=900, stale-while-revalidate=1800')
  })

  it('never caches the degraded empty answer (no key)', async () => {
    vi.stubEnv('SKIDDLE_KEY', '')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await call()
    expect(res.body).toMatchObject({ results: [], unavailable: true })
    expect(res.headers['Cache-Control']).toBe('private, no-store')
  })

  it('never caches the degraded empty answer (upstream auth failure)', async () => {
    vi.stubEnv('SKIDDLE_KEY', 'k')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })))
    const res = await call()
    expect(res.body).toMatchObject({ results: [], unavailable: true })
    expect(res.headers['Cache-Control']).toBe('private, no-store')
  })
})

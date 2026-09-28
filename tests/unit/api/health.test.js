// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// /api/health must report a KV outage (scale audit: probing through cacheGet,
// which fails open, always said 'ok'). KV failing never degrades the status.
const kv = vi.hoisted(() => ({ enabled: true, get: vi.fn() }))
vi.mock('../../../api/lib/db.js', () => ({ testConnection: async () => true }))
vi.mock('../../../api/lib/kvCache.js', () => ({ isCacheEnabled: () => kv.enabled, getClient: () => ({ get: kv.get }) }))
vi.mock('../../../api/lib/cors.js', () => ({ withCors: h => h }))

const { default: health } = await import('../../../api/health.js')
const call = () => new Promise(resolve => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.statusCode = c; return this }, json(b) { resolve({ status: this.statusCode, body: b }); return this } }
  health({ method: 'GET', headers: {} }, res)
})

beforeEach(() => { kv.enabled = true; kv.get.mockReset() })

describe('/api/health KV probe', () => {
  it('ok when the raw client answers', async () => {
    kv.get.mockResolvedValue(null)
    expect(await call()).toMatchObject({ status: 200, body: { status: 'ok', db: 'ok', kv: 'ok' } })
  })
  it('fail (status still ok) when KV errors or throws synchronously', async () => {
    kv.get.mockRejectedValue(new Error('ERR max daily request limit exceeded'))
    expect(await call()).toMatchObject({ status: 200, body: { status: 'ok', kv: 'fail' } })
    kv.get.mockImplementation(() => { throw new Error('boom') })
    expect((await call()).body.kv).toBe('fail')
  })
  it('disabled when KV is not provisioned', async () => {
    kv.enabled = false
    expect((await call()).body.kv).toBe('disabled')
  })
})

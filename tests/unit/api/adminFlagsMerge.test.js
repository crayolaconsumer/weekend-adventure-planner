import { describe, it, expect, beforeEach, vi } from 'vitest'

// POST /api/admin/flags must MERGE the edited booleans into the stored
// roam:flags blob: numeric rollout flags and unknown keys survive, a failed
// read writes nothing, and poiGen (its own key now) is never written here.

const getUserFromRequest = vi.fn()
const kv = { value: null, getError: null, writes: [] }
vi.mock('../../../api/lib/auth.js', () => ({ getUserFromRequest: (...a) => getUserFromRequest(...a) }))
vi.mock('../../../api/lib/kvCache.js', () => ({
  isCacheEnabled: () => true,
  getClient: () => ({ get: async () => { if (kv.getError) throw kv.getError; return kv.value } }),
  cacheGet: async () => (kv.getError ? null : kv.value),
  cacheSet: async (key, value) => { kv.writes.push({ key, value }); kv.value = value; return true },
}))

const { default: handler } = await import('../../../api/admin/flags.js')

let ip = 0
async function post(flags) {
  const res = { statusCode: 200, headers: {} }
  res.status = c => { res.statusCode = c; return res }
  res.json = b => { res.body = b; return res }
  res.setHeader = (k, v) => { res.headers[k] = v }
  res.end = () => res
  await handler({ method: 'POST', headers: { origin: 'https://go-roam.uk', 'x-forwarded-for': `10.7.0.${ip++}` }, query: {}, body: { flags } }, res)
  return res
}

beforeEach(() => {
  Object.assign(kv, { value: null, getError: null, writes: [] })
  getUserFromRequest.mockResolvedValue({ id: 1, is_admin: true })
})

describe('POST /api/admin/flags', () => {
  it('editing a boolean keeps poiDbPct, poiShadowPct and unknown keys', async () => {
    kv.value = { overpassProxy: true, pushNudges: false, poiDbPct: 25, poiShadowPct: 10, somethingNew: 'x' }
    const res = await post({ overpassProxy: false })
    expect(res.statusCode).toBe(200)
    expect(kv.writes).toEqual([{ key: 'roam:flags',
      value: { overpassProxy: false, pushNudges: false, poiDbPct: 25, poiShadowPct: 10, somethingNew: 'x' } }])
    expect(res.body.flags).toMatchObject({ overpassProxy: false, pushNudges: false })
  })

  it('never writes poiGen (it lives in roam:poiGen)', async () => {
    kv.value = { poiGen: 9, poiDbPct: 5 }
    await post({ pushNudges: false })
    expect(kv.writes[0].value).toEqual({ poiDbPct: 5, pushNudges: false })
  })

  it('a KV read error writes nothing', async () => {
    kv.value = { poiDbPct: 25 }
    kv.getError = new Error('upstash down')
    const res = await post({ overpassProxy: false })
    expect(res.statusCode).toBe(503)
    expect(kv.writes).toEqual([])
  })

  it('an empty store gets just the edited flag', async () => {
    await post({ contributionsUpload: false })
    expect(kv.writes[0].value).toEqual({ contributionsUpload: false })
  })
})

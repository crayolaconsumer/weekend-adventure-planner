import { describe, it, expect, beforeEach, vi } from 'vitest'

// POST /api/admin/flags must MERGE the edited booleans into the stored
// roam:flags blob: numeric rollout flags and unknown keys survive, a failed
// read writes nothing.

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

  it('a KV read error writes nothing', async () => {
    kv.value = { poiDbPct: 25 }
    kv.getError = new Error('upstash down')
    const res = await post({ overpassProxy: false })
    expect(res.statusCode).toBe(503)
    expect(kv.writes).toEqual([])
  })

  it('sets a rollout percentage and keeps the other keys; 0 is the kill switch', async () => {
    kv.value = { overpassProxy: false, poiDbPct: 25 }
    const res = await post({ poiShadowPct: 10 })
    expect(res.statusCode).toBe(200)
    expect(kv.value).toEqual({ overpassProxy: false, poiDbPct: 25, poiShadowPct: 10 })
    expect(res.body.flags).toMatchObject({ poiDbPct: 25, poiShadowPct: 10 })
    await post({ poiDbPct: 0 })
    expect(kv.value.poiDbPct).toBe(0)
    // the dense-area cap: its own key, validated like the others
    expect((await post({ poiCapPct: 5 })).body.flags).toMatchObject({ poiDbPct: 0, poiShadowPct: 10, poiCapPct: 5 })
    expect((await post({ poiCapPct: 101 })).statusCode).toBe(400)
  })

  it.each([150, 12.7, '10', null, undefined])('kill switch writes 0 over a stored %j, and GET matches what is served', async (bad) => {
    kv.value = { poiDbPct: bad }
    const res = await post({ poiDbPct: 0 })
    expect(res.statusCode).toBe(200)
    expect(kv.value.poiDbPct).toBe(0)
    kv.value = { poiDbPct: 150 }
    expect((await post({ pushNudges: false })).body.flags.poiDbPct).toBe(100)
  })

  it('GET shows the truncated value that is served', async () => {
    kv.value = { poiDbPct: 12.7 }
    expect((await post({ pushNudges: false })).body.flags.poiDbPct).toBe(12)
  })

  it('a non-admin writes nothing', async () => {
    getUserFromRequest.mockResolvedValue({ id: 2, is_admin: false })
    kv.value = { poiDbPct: 5 }
    const res = await post({ poiDbPct: 0 })
    expect(res.statusCode).toBe(404)
    expect(kv.writes).toEqual([])
  })

  it('a __proto__ key cannot smuggle a flag in', async () => {
    kv.value = { poiDbPct: 5 }
    const res = await post(JSON.parse('{"__proto__":{"poiDbPct":50},"pushNudges":false}'))
    expect(res.statusCode).toBe(200)
    expect(kv.value).toEqual({ poiDbPct: 5, pushNudges: false })
  })

  it('ignores inherited names like constructor', async () => {
    const res = await post({ constructor: 'x', pushNudges: false })
    expect(res.statusCode).toBe(200)
    expect(kv.value).toEqual({ pushNudges: false })
  })

  it.each([
    ['poiDbPct', 101], ['poiDbPct', -1], ['poiDbPct', 2.5], ['poiDbPct', '50'], ['poiDbPct', true], ['overpassProxy', 0],
  ])('rejects %s = %j and writes nothing', async (k, v) => {
    kv.value = { poiDbPct: 5 }
    const res = await post({ [k]: v, pushNudges: false })
    expect(res.statusCode).toBe(400)
    expect(kv.writes).toEqual([])
  })

  it('an empty store gets just the edited flag', async () => {
    await post({ contributionsUpload: false })
    expect(kv.writes[0].value).toEqual({ contributionsUpload: false })
  })
})

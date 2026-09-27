import { describe, it, expect, beforeEach, vi } from 'vitest'

// Every /api/admin/* route must look like a missing route (404) to anyone
// who isn't an admin calling from our own frontend, and the IP rate limit
// must trip before auth is even looked at.

const getUserFromRequest = vi.fn()
vi.mock('../../../api/lib/auth.js', () => ({ getUserFromRequest: (...a) => getUserFromRequest(...a) }))
vi.mock('../../../api/lib/db.js', () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  update: vi.fn(async () => 1),
  insert: vi.fn(async () => 1),
  transaction: vi.fn(),
}))
vi.mock('../../../api/lib/kvCache.js', () => ({
  cacheGet: vi.fn(), cacheSet: vi.fn(), isCacheEnabled: () => false, getClient: () => null,
}))

const LOADERS = import.meta.glob('../../../api/admin/*.js')
const ROUTES = Object.keys(LOADERS).map((p) => p.split('/').pop())

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  res.setHeader = (k, v) => { res.headers[k] = v }
  res.end = () => res
  return res
}

let ipSeq = 0
function req({ origin = 'https://go-roam.uk', method = 'GET', ip } = {}) {
  const headers = { 'x-forwarded-for': ip || `10.0.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}` }
  if (origin) headers.origin = origin
  return { method, headers, query: {}, body: {} }
}

async function call(route, r) {
  const handler = (await LOADERS[`../../../api/admin/${route}`]()).default
  const res = mockRes()
  await handler(r, res)
  return res
}

const ADMIN = { id: 1, username: 'owner', is_admin: 1 }

beforeEach(() => getUserFromRequest.mockReset())

it('sweeps a non-trivial number of admin routes', () => {
  expect(ROUTES.length).toBeGreaterThanOrEqual(8)
})

describe.each(ROUTES)('/api/admin/%s', (route) => {
  it('404s with no auth', async () => {
    getUserFromRequest.mockResolvedValue(null)
    const res = await call(route, req())
    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ error: 'Not found' })
  })

  it('404s for a signed-in non-admin', async () => {
    getUserFromRequest.mockResolvedValue({ id: 2, is_admin: 0 })
    const res = await call(route, req())
    expect(res.statusCode).toBe(404)
  })

  it('404s an admin from a foreign origin, before auth', async () => {
    getUserFromRequest.mockResolvedValue(ADMIN)
    const res = await call(route, req({ origin: 'https://evil.example' }))
    expect(res.statusCode).toBe(404)
    expect(getUserFromRequest).not.toHaveBeenCalled()
  })

  it('404s an admin with no origin or referer', async () => {
    getUserFromRequest.mockResolvedValue(ADMIN)
    const res = await call(route, req({ origin: null }))
    expect(res.statusCode).toBe(404)
  })

  it('rate-limits by IP before auth', async () => {
    getUserFromRequest.mockResolvedValue(null)
    const ip = `192.0.2.${ROUTES.indexOf(route) + 1}`
    let res
    for (let i = 0; i < 101; i++) res = await call(route, req({ ip }))
    getUserFromRequest.mockClear()
    getUserFromRequest.mockResolvedValue(ADMIN)
    res = await call(route, req({ ip }))
    expect(res.statusCode).toBe(404)
    expect(getUserFromRequest).not.toHaveBeenCalled()
  })

  it('lets an admin from our origin through', async () => {
    getUserFromRequest.mockResolvedValue(ADMIN)
    const res = await call(route, req())
    expect(res.statusCode).not.toBe(404)
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Self-serve delete and Sign in with Apple revocation both route through
// the shared deleteUserAccount (so both also clean up photo blobs).

const deleteUserAccount = vi.fn(async () => {})
const queryOne = vi.fn()
const getUserFromRequest = vi.fn()
const jwtVerify = vi.fn()

vi.mock('../../../api/lib/accounts.js', () => ({ deleteUserAccount: (...a) => deleteUserAccount(...a) }))
vi.mock('../../../api/lib/db.js', () => ({
  queryOne: (...a) => queryOne(...a), insert: vi.fn(), update: vi.fn(), query: vi.fn(async () => []),
}))
vi.mock('../../../api/lib/rateLimit.js', () => ({ applyRateLimit: () => null, RATE_LIMITS: {} }))
vi.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: (...a) => jwtVerify(...a) }))
vi.mock('../../../api/lib/auth.js', async (orig) => ({
  ...(await orig()),
  getUserFromRequest: (...a) => getUserFromRequest(...a),
}))

function mockRes() {
  const out = { status: 200, headers: {} }
  return {
    out,
    setHeader: (k, v) => { out.headers[k] = v },
    getHeader: (k) => out.headers[k],
    status(c) { out.status = c; return this },
    json(b) { out.body = b; return this },
    end() { return this },
  }
}

beforeEach(() => {
  vi.resetModules()
  deleteUserAccount.mockReset().mockResolvedValue()
  queryOne.mockReset()
  vi.stubEnv('JWT_SECRET', 'test-secret-test-secret-test-secret')
  vi.stubEnv('APPLE_SIGNIN_SERVICES_ID', 'com.goroam.app.signin')
})

describe('self-serve delete (api/auth action=delete)', () => {
  it('uses deleteUserAccount and returns success', async () => {
    const { default: handler } = await import('../../../api/auth/index.js')
    getUserFromRequest.mockResolvedValue({ id: 5, username: 'sam' })
    queryOne.mockResolvedValue({ last_login_at: new Date() })
    const res = mockRes()
    await handler({ method: 'POST', headers: {}, body: { action: 'delete', confirmUsername: 'sam' } }, res)
    expect(res.out.status).toBe(200)
    expect(deleteUserAccount).toHaveBeenCalledWith(5)
  })

  it('returns 500 when the delete fails', async () => {
    const { default: handler } = await import('../../../api/auth/index.js')
    getUserFromRequest.mockResolvedValue({ id: 5, username: 'sam' })
    queryOne.mockResolvedValue({ last_login_at: new Date() })
    deleteUserAccount.mockRejectedValue(new Error('db'))
    const res = mockRes()
    await handler({ method: 'POST', headers: {}, body: { action: 'delete', confirmUsername: 'sam' } }, res)
    expect(res.out.status).toBe(500)
  })
})

describe('apple-notifications account-delete', () => {
  it('uses deleteUserAccount for the matching apple_id', async () => {
    const { default: handler } = await import('../../../api/auth/apple-notifications.js')
    jwtVerify.mockResolvedValue({ payload: { events: JSON.stringify({ type: 'account-delete', sub: 'apple-1' }) } })
    queryOne.mockResolvedValue({ id: 9, username: 'ap' })
    const res = mockRes()
    await handler({ method: 'POST', headers: {}, body: { payload: 'jwt' } }, res)
    expect(res.out.status).toBe(200)
    expect(deleteUserAccount).toHaveBeenCalledWith(9)
  })

  it('asks Apple to retry when the delete fails', async () => {
    const { default: handler } = await import('../../../api/auth/apple-notifications.js')
    jwtVerify.mockResolvedValue({ payload: { events: { type: 'consent-revoked', sub: 'apple-1' } } })
    queryOne.mockResolvedValue({ id: 9, username: 'ap' })
    deleteUserAccount.mockRejectedValue(new Error('db'))
    const res = mockRes()
    await handler({ method: 'POST', headers: {}, body: { payload: 'jwt' } }, res)
    expect(res.out.status).toBe(500)
  })
})

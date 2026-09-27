import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import jwt from 'jsonwebtoken'

// users.token_version revokes sessions: a token is only valid while its tv
// claim matches the account's current version.
const SECRET = 'test-secret-test-secret-test-secret'
let dbUser
const queryOne = vi.fn(async () => (dbUser ? { ...dbUser } : null))
vi.mock('../../../api/lib/db.js', () => ({ queryOne: (...a) => queryOne(...a), query: vi.fn(), update: vi.fn(), insert: vi.fn() }))

let auth
beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv('JWT_SECRET', SECRET)
  auth = await import('../../../api/lib/auth.js')
  dbUser = { id: 5, email: 'a@b.co', username: 'sam', is_admin: 0, is_banned: 0, token_version: 0 }
})
afterEach(() => vi.unstubAllEnvs())

const req = token => ({ headers: { authorization: `Bearer ${token}` } })

describe('token_version session revocation', () => {
  it('a token issued before the column existed (no tv) stays valid at version 0', async () => {
    const legacy = jwt.sign({ userId: 5, email: 'a@b.co', username: 'sam' }, SECRET, { expiresIn: '30d' })
    expect((await auth.getUserFromRequest(req(legacy)))?.id).toBe(5)
  })

  it('issues tokens carrying the current version, which then validate', async () => {
    dbUser.token_version = 3
    const token = auth.generateToken(dbUser)
    expect(jwt.decode(token).tv).toBe(3)
    expect((await auth.getUserFromRequest(req(token)))?.id).toBe(5)
  })

  it('rejects every token from before a version bump (regression: hijacked sessions survived)', async () => {
    const before = auth.generateToken(dbUser)
    dbUser.token_version = 1
    expect(await auth.getUserFromRequest(req(before))).toBeNull()
  })
})

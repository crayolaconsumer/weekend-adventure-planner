import { describe, it, expect, beforeEach, vi } from 'vitest'

// DELETE /api/admin/users: fresh login, never self, never an admin, target
// must exist, typed confirmation, audit row with username + email domain only.

const getUserFromRequest = vi.fn()
const queryOne = vi.fn()
const query = vi.fn(async () => [])
const insert = vi.fn(async () => 1)
const deleteUserAccount = vi.fn(async () => {})

vi.mock('../../../api/lib/auth.js', () => ({ getUserFromRequest: (...a) => getUserFromRequest(...a) }))
vi.mock('../../../api/lib/db.js', () => ({
  query: (...a) => query(...a),
  queryOne: (...a) => queryOne(...a),
  update: vi.fn(),
  insert: (...a) => insert(...a),
}))
vi.mock('../../../api/lib/rateLimit.js', () => ({
  applyRateLimit: () => null, getRateLimitKey: () => '203.0.113.9', RATE_LIMITS: {},
}))
vi.mock('../../../api/lib/accounts.js', () => ({ deleteUserAccount: (...a) => deleteUserAccount(...a) }))

const { default: handler, TEST_ACCOUNT_SQL } = await import('../../../api/admin/users.js')

const ADMIN = { id: 1, username: 'owner', is_admin: 1 }
const TARGET = { id: 7, username: 'demo_user', email: 'demo@mailinator.com', is_admin: 0 }

function mockRes() {
  const res = { statusCode: 200 }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  res.setHeader = () => {}
  return res
}

function db({ fresh = true, target = TARGET } = {}) {
  queryOne.mockImplementation(async (sql) => {
    if (/last_login_at/.test(sql)) return { last_login_at: fresh ? new Date() : new Date(Date.now() - 3600e3) }
    if (/FROM users WHERE id = \?/.test(sql)) return target
    return { total: 0 }
  })
}

async function del(body) {
  const res = mockRes()
  await handler({ method: 'DELETE', headers: { origin: 'https://go-roam.uk', 'user-agent': 'ua' }, query: {}, body }, res)
  return res
}

beforeEach(() => {
  getUserFromRequest.mockResolvedValue(ADMIN)
  deleteUserAccount.mockClear()
  insert.mockClear()
  query.mockClear()
  db()
})

describe('admin account delete', () => {
  it('deletes the target and writes an audit row without the full email', async () => {
    const res = await del({ id: 7, confirm: 'demo_user' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(deleteUserAccount).toHaveBeenCalledWith(7)
    const [sql, params] = insert.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO admin_actions/)
    expect(params[1]).toBe('user.delete')
    expect(params[2]).toBe('7')
    expect(JSON.parse(params[5])).toEqual({ username: 'demo_user', email_domain: 'mailinator.com' })
    expect(params[5]).not.toContain('demo@')
  })

  it('requires a fresh login', async () => {
    db({ fresh: false })
    const res = await del({ id: 7, confirm: 'demo_user' })
    expect(res.statusCode).toBe(401)
    expect(res.body.code).toBe('STALE_SESSION')
    expect(deleteUserAccount).not.toHaveBeenCalled()
  })

  it('refuses to delete yourself', async () => {
    // Target row stubbed as a non-admin so only the self check can stop it.
    db({ target: { id: 1, username: 'owner', email: 'o@go-roam.uk', is_admin: 0 } })
    const res = await del({ id: 1, confirm: 'owner' })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/your own account/)
    expect(deleteUserAccount).not.toHaveBeenCalled()
  })

  it('refuses to delete an admin', async () => {
    db({ target: { ...TARGET, is_admin: 1 } })
    const res = await del({ id: 7, confirm: 'demo_user' })
    expect(res.statusCode).toBe(403)
    expect(deleteUserAccount).not.toHaveBeenCalled()
  })

  it('404s a missing target', async () => {
    db({ target: null })
    const res = await del({ id: 7, confirm: 'demo_user' })
    expect(res.statusCode).toBe(404)
    expect(deleteUserAccount).not.toHaveBeenCalled()
  })

  it('needs the exact username typed', async () => {
    const res = await del({ id: 7, confirm: 'demo_use' })
    expect(res.statusCode).toBe(400)
    expect(deleteUserAccount).not.toHaveBeenCalled()
  })

  it('falls back to the email when the account has no username', async () => {
    db({ target: { ...TARGET, username: null } })
    expect((await del({ id: 7, confirm: '' })).statusCode).toBe(400)
    expect((await del({ id: 7, confirm: 'demo@mailinator.com' })).statusCode).toBe(200)
  })

  it('rejects a non-integer id', async () => {
    expect((await del({ id: '7', confirm: 'demo_user' })).statusCode).toBe(404)
    expect(deleteUserAccount).not.toHaveBeenCalled()
  })
})

describe('likely test accounts filter', () => {
  it('applies the test-account clause to both the list and the count', async () => {
    const res = mockRes()
    await handler({ method: 'GET', headers: { origin: 'https://go-roam.uk' }, query: { filter: 'test' } }, res)
    expect(res.body.filter).toBe('test')
    expect(query.mock.calls[0][0]).toContain(TEST_ACCOUNT_SQL)
    const countSql = queryOne.mock.calls.find(([s]) => /COUNT\(\*\) AS total/.test(s))[0]
    expect(countSql).toContain(TEST_ACCOUNT_SQL)
    expect(countSql).toMatch(/LEFT JOIN user_stats s/)
  })

  it('matches the throwaway patterns and the zero-activity rule', () => {
    for (const p of ['test', 'demo', 'example', 'mailinator']) expect(TEST_ACCOUNT_SQL).toContain(p)
    expect(TEST_ACCOUNT_SQL).toMatch(/INTERVAL 7 DAY/)
    expect(TEST_ACCOUNT_SQL).toMatch(/total_swipes, 0\) = 0/)
  })
})

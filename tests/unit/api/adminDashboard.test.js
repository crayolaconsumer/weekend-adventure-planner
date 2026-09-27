import { it, expect, vi } from 'vitest'

// Dashboard key numbers: users in one pass, DAU/WAU from user_stats,
// totals for saves/visits, live promoted events. MySQL SUM() comes back
// as a DECIMAL string, so the handler must coerce to numbers.

const queryOne = vi.fn(async (sql) => {
  if (/FROM users/.test(sql)) return { total: '40', premium: '3', banned: '1', new_7d: '5', new_30d: '12' }
  if (/FROM user_stats/.test(sql)) return { dau: '4', wau: '9' }
  if (/FROM saved_places/.test(sql)) return { n: 120 }
  if (/FROM visited_places/.test(sql)) return { n: 33 }
  if (/FROM promoted_events/.test(sql)) return { n: 2 }
  return { n: 0 }
})

vi.mock('../../../api/lib/auth.js', () => ({ getUserFromRequest: async () => ({ id: 1, is_admin: 1 }) }))
vi.mock('../../../api/lib/db.js', () => ({ queryOne: (...a) => queryOne(...a) }))
vi.mock('../../../api/lib/rateLimit.js', () => ({ applyRateLimit: () => null, getRateLimitKey: () => 'ip', RATE_LIMITS: {} }))

const { default: handler } = await import('../../../api/admin/dashboard.js')

it('returns the owner key numbers as numbers', async () => {
  const res = { status(c) { this.code = c; return this }, json(b) { this.body = b; return this }, setHeader() {} }
  await handler({ method: 'GET', headers: { origin: 'https://go-roam.uk' } }, res)
  expect(res.code).toBe(200)
  expect(res.body.users).toEqual({ total: 40, premium: 3, banned: 1, new_7d: 5, new_30d: 12 })
  expect(res.body.activity).toEqual({ dau: 4, wau: 9, saves: 120, visits: 33 })
  expect(res.body.promoted).toEqual({ live: 2 })
  const promotedSql = queryOne.mock.calls.map(([s]) => s).find((s) => /promoted_events/.test(s))
  expect(promotedSql).toMatch(/status = 'active' AND payment_status = 'paid' AND moderation_status = 'live'/)
})

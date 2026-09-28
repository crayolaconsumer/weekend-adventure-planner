// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Races the load test found (1,000 VUs, 27-28 Sep): concurrent swipe batches for
// one user deadlocked, and a double-tapped follow hit the unique key. Both
// must answer as if the write had gone through once.
const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), insert: vi.fn(), update: vi.fn() }))
const notify = vi.hoisted(() => vi.fn())
const push = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../../api/lib/db.js', () => db)
vi.mock('../../../api/lib/auth.js', () => ({ getUserFromRequest: async () => ({ id: 7, username: 'me' }) }))
vi.mock('../../../api/lib/cors.js', () => ({ withCors: h => h }))
vi.mock('../../../api/lib/rateLimit.js', () => ({ applyRateLimit: () => null, RATE_LIMITS: {} }))
vi.mock('../../../api/notifications/index.js', () => ({ createNotification: notify }))
vi.mock('../../../api/lib/pushNotifications.js', () => ({ notifyNewFollower: push }))
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }))
vi.mock('../../../api/social/block.js', () => ({ hasBlockBetween: async () => false }))
vi.mock('../../../api/users/badges.js', () => ({ evaluateBadges: async () => {} }))
const priv = vi.hoisted(() => ({ value: false }))
vi.mock('../../../api/lib/privacy.js', () => ({ isAccountPrivate: () => priv.value, resolvePrivacy: async () => ({}) }))

const { default: swiped } = await import('../../../api/places/swiped.js')
const { default: social } = await import('../../../api/social/index.js')

const call = (handler, body) => new Promise(resolve => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v }, getHeader(k) { return this.headers[k] },
    status(c) { this.statusCode = c; return this }, json(b) { resolve({ status: this.statusCode, body: b }); return this }, end() { resolve({ status: this.statusCode }); return this } }
  handler({ method: 'POST', headers: {}, query: {}, body }, res)
})
const deadlock = () => Object.assign(new Error('Deadlock found when trying to get lock'), { errno: 1213, code: 'ER_LOCK_DEADLOCK' })
const dup = () => Object.assign(new Error("Duplicate entry '7-9' for key 'follows.unique_follow'"), { errno: 1062, code: 'ER_DUP_ENTRY' })

beforeEach(() => { for (const f of Object.values(db)) f.mockReset(); notify.mockReset(); push.mockClear(); priv.value = false; vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('swipe batches', () => {
  it('retry a deadlock (the statement was rolled back) and succeed', async () => {
    db.query.mockRejectedValueOnce(deadlock()).mockResolvedValueOnce({})
    const r = await call(swiped, { swipes: [{ placeId: 'b', action: 'skip' }, { placeId: 'a', action: 'like' }] })
    expect(r).toMatchObject({ status: 200, body: { success: true, processed: 2 } })
    expect(db.query).toHaveBeenCalledTimes(2)
  })

  it('give up after 3 deadlocks, and never retry other errors', async () => {
    db.query.mockRejectedValue(deadlock())
    expect((await call(swiped, { swipes: [{ placeId: 'a', action: 'skip' }] })).status).toBe(500)
    expect(db.query).toHaveBeenCalledTimes(3)
    db.query.mockReset().mockRejectedValue(new Error('boom'))
    expect((await call(swiped, { swipes: [{ placeId: 'a', action: 'skip' }] })).status).toBe(500)
    expect(db.query).toHaveBeenCalledTimes(1)
  })

  it('write one row per place (last action wins) in a fixed order, so batches lock rows alike', async () => {
    db.query.mockResolvedValue({})
    await call(swiped, { swipes: [{ placeId: 'c', action: 'skip' }, { placeId: 'a', action: 'skip' }, { placeId: 'c', action: 'like' }] })
    expect(db.query.mock.calls[0][1]).toEqual([7, 'a', 'skip', 7, 'c', 'like'])
  })
})

describe('swipe batch inputs', () => {
  it('numeric and string ids sort alike, processed still counts what the client sent, junk ids are refused', async () => {
    db.query.mockResolvedValue({})
    const r = await call(swiped, { swipes: [{ placeId: 12, action: 'skip' }, { placeId: '3', action: 'like' }, { placeId: 12, action: 'like' }] })
    expect(r.body).toMatchObject({ processed: 3 })
    expect(db.query.mock.calls[0][1]).toEqual([7, '12', 'like', 7, '3', 'like'])
    db.query.mockClear()
    for (const bad of [{}, [], '', null, true]) expect((await call(swiped, { swipes: [{ placeId: bad, action: 'skip' }] })).status).toBe(400)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('a retry resends the identical statement', async () => {
    db.query.mockRejectedValueOnce(deadlock()).mockResolvedValueOnce({})
    await call(swiped, { swipes: [{ placeId: 'a', action: 'skip' }] })
    expect(db.query.mock.calls[1]).toEqual(db.query.mock.calls[0])
  })
})

describe('follow double tap', () => {
  const target = { id: 9, username: 'them' }
  it('a follow that loses the race answers "Already following" with no second notification', async () => {
    db.queryOne.mockImplementation(async sql => (/FROM users WHERE id/.test(sql) ? target : null))
    db.insert.mockRejectedValueOnce(dup())
    const r = await call(social, { action: 'follow', userId: 9 })
    expect(r).toMatchObject({ status: 200, body: { status: 'following', message: 'Already following' } })
    expect(notify).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('a private account\'s double-tapped request answers "Request already pending", once', async () => {
    priv.value = true
    db.queryOne.mockImplementation(async sql => (/FROM users WHERE id/.test(sql) ? target : null))
    db.insert.mockRejectedValueOnce(dup())
    const r = await call(social, { action: 'follow', userId: 9 })
    expect(r).toMatchObject({ status: 200, body: { status: 'requested', message: 'Request already pending' } })
    expect(notify).not.toHaveBeenCalled()
  })

  it('any other insert error is still an error', async () => {
    db.queryOne.mockImplementation(async sql => (/FROM users WHERE id/.test(sql) ? target : null))
    db.insert.mockRejectedValueOnce(new Error('boom'))
    expect((await call(social, { action: 'follow', userId: 9 })).status).toBe(500)
  })
})

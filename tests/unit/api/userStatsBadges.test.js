import { describe, it, expect, beforeEach, vi } from 'vitest'

// Scale P0: every swipe PUTs /api/users/stats. A swipe-only write must be
// one statement and must not run badge evaluation; other stats writes still
// evaluate badges, and the response shape old clients read stays the same.

const calls = [] // every SQL statement sent, in order
let statsRowExists = true
let badgeRow = null // what the evaluateBadges read returns

function record(sql, params) {
  calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
}

vi.mock('../../../api/lib/db.js', () => ({
  query: vi.fn(async (sql, params) => {
    record(sql, params)
    if (/^INSERT IGNORE INTO user_stats/.test(sql)) statsRowExists = true
    return /^\s*SELECT/.test(sql) ? [badgeRow].filter(Boolean) : { affectedRows: 1 }
  }),
  queryOne: vi.fn(async (sql, params) => {
    record(sql, params)
    return badgeRow
  }),
  update: vi.fn(async (sql, params) => {
    record(sql, params)
    return statsRowExists ? 1 : 0
  }),
}))
vi.mock('../../../api/lib/rateLimit.js', () => ({ applyRateLimit: () => null, RATE_LIMITS: {} }))
vi.mock('../../../api/lib/auth.js', () => ({ getUserFromRequest: async () => ({ id: 7 }) }))
const pending = []
vi.mock('@vercel/functions', () => ({ waitUntil: p => pending.push(p) }))

const { default: handler } = await import('../../../api/users/stats.js')
const { evaluateBadges } = await import('../../../api/users/badges.js')

async function put(body) {
  const out = { status: 200, body: null }
  const res = {
    setHeader() {},
    status(c) { out.status = c; return this },
    json(b) { out.body = b; return this },
    end() { return this },
  }
  await handler({ method: 'PUT', headers: {}, body }, res)
  await Promise.all(pending.splice(0))
  return out
}

const badgeReads = () => calls.filter(c => /^SELECT/.test(c.sql) && /user_badges|COUNT\(\*\)/.test(c.sql))
const badgeInserts = () => calls.filter(c => /^INSERT IGNORE INTO user_badges/.test(c.sql))

beforeEach(() => {
  calls.length = 0
  pending.length = 0
  statsRowExists = true
  badgeRow = null
})

describe('PUT /api/users/stats, swipe path', () => {
  it('a swipe is one UPDATE and no badge queries', async () => {
    const out = await put({ increment: { totalSwipes: 1 } })
    expect(out).toEqual({ status: 200, body: { success: true } })
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toBe(
      'UPDATE user_stats SET total_swipes = LEAST(total_swipes + ?, 999999999) WHERE user_id = ?'
    )
    expect(calls[0].params).toEqual([1, 7])
    expect(pending).toHaveLength(0)
  })

  it('left/right swipe counters (old builds) also skip badges', async () => {
    await put({ increment: { totalSwipes: 1, swipesRight: 1 } })
    await put({ increment: { swipesLeft: 1 }, totalSwipes: 40 })
    expect(badgeReads()).toHaveLength(0)
    expect(calls).toHaveLength(2)
  })

  it('first write for a user creates the row, then applies the update', async () => {
    statsRowExists = false
    const out = await put({ increment: { totalSwipes: 1 } })
    expect(out.body).toEqual({ success: true })
    expect(calls.map(c => c.sql.split(' ').slice(0, 3).join(' '))).toEqual([
      'UPDATE user_stats SET',
      'INSERT IGNORE INTO',
      'UPDATE user_stats SET',
    ])
    expect(badgeReads()).toHaveLength(0)
  })

  it('a swipe mixed with a badge-relevant field still evaluates badges', async () => {
    await put({ increment: { totalSwipes: 1, timesWentOut: 1 }, currentStreak: 3 })
    expect(badgeReads()).toHaveLength(1)
  })

  it('invalid body is still a 400 and writes nothing', async () => {
    const out = await put({ increment: { totalSwipes: 0 }, bogus: 5 })
    expect(out).toEqual({ status: 400, body: { error: 'No valid stats to update' } })
    expect(calls).toHaveLength(0)
  })
})

describe('PUT /api/users/stats, non-swipe path', () => {
  it('a streak write awards the streak badges it earned, in one INSERT', async () => {
    badgeRow = { cs: 7, bs: 7, bb: 0, saved: 0, plans: 0, visited: 0, contribs: 0, followers: 0, helpful: '0', owned: null }
    const out = await put({ currentStreak: 7, bestStreak: 7, lastStreakDate: '2026-09-27' })
    expect(out).toEqual({ status: 200, body: { success: true } })
    expect(badgeReads()).toHaveLength(1)
    expect(badgeInserts()).toHaveLength(1)
    expect(badgeInserts()[0].params).toEqual([7, 'streak_3', 7, 'streak_7'])
    expect(calls).toHaveLength(3) // UPDATE, badge read, badge insert
  })

  it('a visit counter write still runs badge evaluation', async () => {
    badgeRow = { cs: 0, bs: 0, bb: 0, saved: 0, plans: 0, visited: 1, contribs: 0, followers: 0, helpful: 0, owned: null }
    await put({ increment: { placesVisited: 1 } })
    expect(badgeInserts()[0].params).toEqual([7, 'first_visit'])
  })

  it('placesSaved write still runs badge evaluation', async () => {
    badgeRow = { cs: 0, bs: 0, bb: 0, saved: 20, plans: 0, visited: 0, contribs: 0, followers: 0, helpful: 0, owned: null }
    await put({ increment: { placesSaved: 1 } })
    expect(badgeInserts()[0].params).toEqual([7, 'curator'])
  })
})

describe('evaluateBadges', () => {
  it('reads everything in one statement and inserts only missing badges', async () => {
    badgeRow = {
      cs: 0, bs: 30, bb: 10, saved: 25, plans: 5, visited: 12, contribs: 1,
      followers: 100, helpful: '50', owned: 'streak_3,streak_7,first_visit,curator',
    }
    await evaluateBadges(7)
    expect(calls).toHaveLength(2)
    expect(calls[0].params).toEqual(Array(10).fill(7))
    const inserted = badgeInserts()[0].params.filter((_, i) => i % 2 === 1)
    expect(inserted).toEqual([
      'streak_30', 'visits_10', 'first_contribution', 'followers_10', 'followers_100',
      'just_go', 'planner', 'helpful_10', 'helpful_50',
    ])
    expect(calls[1].sql).toMatch(/^INSERT IGNORE INTO user_badges \(user_id, badge_id\) VALUES (\(\?, \?\), ){8}\(\?, \?\)$/)
  })

  it('writes nothing when every earned badge is already owned', async () => {
    badgeRow = { cs: 3, bs: 3, bb: 0, saved: 0, plans: 0, visited: 1, contribs: 0, followers: 0, helpful: 0, owned: 'streak_3,first_visit' }
    await evaluateBadges(7)
    expect(calls).toHaveLength(1)
  })

  it('a user with no stats row and no activity earns nothing', async () => {
    badgeRow = { cs: null, bs: null, bb: null, saved: 0, plans: 0, visited: 0, contribs: 0, followers: 0, helpful: 0, owned: null }
    await evaluateBadges(7)
    expect(calls).toHaveLength(1)
  })
})

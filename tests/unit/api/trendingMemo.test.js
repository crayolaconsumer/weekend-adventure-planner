import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The global trending ranking (a 30-day UNION/GROUP BY over three tables) runs at
// most once per 5 min per instance; viewer block filters still run per request
const query = vi.fn()
let viewer = null
vi.mock('../../../api/lib/db.js', () => ({ query: (...a) => query(...a) }))
vi.mock('../../../api/lib/auth.js', () => ({ getUserFromRequest: async () => viewer }))
vi.mock('../../../api/lib/rateLimit.js', () => ({ applyRateLimit: () => null, RATE_LIMITS: {} }))

const { default: handler, _resetTrendingMemo } = await import('../../../api/places/trending.js')

const RANK = [{ place_id: 'p1', contribution_count: 1, save_count: 2, visit_count: 0, popularity_score: 5 }]
function route(sql) {
  if (sql.includes('popularity_score')) return RANK
  if (sql.includes("contribution_type = 'tip'")) return []
  if (sql.includes("contribution_type = 'photo'")) return []
  if (sql.includes('place_data')) return [{ place_id: 'p1', place_data: JSON.stringify({ name: 'Minster' }) }]
  throw new Error(`unexpected ${sql}`)
}
const calls = kind => query.mock.calls.filter(([sql]) => ({
  rank: sql.includes('popularity_score'), data: sql.includes('place_data') && !sql.includes('popularity_score'), tips: sql.includes("contribution_type = 'tip'")
})[kind]).length

async function get(q = {}) {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, getHeader(k) { return this.headers[k] }, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this }, end() { return this } }
  await handler({ method: 'GET', query: q, headers: { origin: 'https://www.go-roam.uk' } }, res)
  return res
}

describe('trending: global ranking memoized per instance', () => {
  beforeEach(() => { _resetTrendingMemo(); query.mockReset(); query.mockImplementation(async sql => route(sql)); viewer = null })
  afterEach(() => vi.useRealTimers())

  it('50 requests run the ranking and place-data queries once; tips still per request', async () => {
    for (let i = 0; i < 50; i++) expect((await get()).body.trending[0].placeName).toBe('Minster')
    expect(calls('rank')).toBe(1)
    expect(calls('data')).toBe(1)
    expect(calls('tips')).toBe(50)
  })

  it('20 concurrent requests share one in-flight ranking run', async () => {
    let release
    query.mockImplementation(sql => sql.includes('popularity_score') ? new Promise(r => { release = () => r(RANK) }) : route(sql))
    const pending = Array.from({ length: 20 }, () => get())
    await new Promise(r => setTimeout(r, 10))
    release()
    const out = await Promise.all(pending)
    expect(out.map(o => o.statusCode)).toEqual(Array(20).fill(200))
    expect(calls('rank')).toBe(1)
  })

  it('never holds more than 200 entries (a days x limit sweep)', async () => {
    for (let days = 1; days <= 90; days++) for (const limit of [1, 2, 3]) await get({ days: String(days), limit: String(limit) })
    query.mockClear()
    await get({ days: '1', limit: '1' }) // evicted long ago: runs again
    expect(calls('rank')).toBe(1)
  })

  it('refreshes after 5 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await get()
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1)
    await get()
    expect(calls('rank')).toBe(2)
  })

  it('a failed ranking query is not cached', async () => {
    query.mockImplementationOnce(async () => { throw new Error('DB down') })
    expect((await get()).statusCode).toBe(500)
    expect((await get()).statusCode).toBe(200)
    expect(calls('rank')).toBe(2)
  })

  it('different windows and limits are separate entries', async () => {
    await get({ days: '7' })
    await get({ days: '30', limit: '5' })
    await get({ days: '7' })
    expect(calls('rank')).toBe(2)
  })

  it('a signed-in viewer still gets the per-request block filter on tips', async () => {
    viewer = { id: 42 }
    await get()
    const tips = query.mock.calls.find(([sql]) => sql.includes("contribution_type = 'tip'"))
    expect(tips[0]).toContain('blocked_users')
    expect(tips[1]).toEqual(['p1', 42, 42])
  })
})

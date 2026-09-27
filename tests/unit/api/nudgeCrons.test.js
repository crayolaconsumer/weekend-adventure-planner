import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import process from 'node:process'

process.env.CRON_SECRET = 'test-secret'

// In-memory KV so the real cronCursor runs
const kv = new Map()
let kvClient
const workingKv = {
  get: async k => kv.get(k) ?? null,
  set: async (k, v) => { kv.set(k, v); return 'OK' }
}
vi.mock('../../../api/lib/kvCache.js', () => ({ getClient: () => kvClient }))

// 2,500 eligible users, ids 1..2500; the fake DB honours `id > ?` and LIMIT
const ALL_USERS = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, username: `u${i + 1}` }))
const query = vi.fn(async (sql, params = []) => {
  const limit = Number(/LIMIT (\d+)/.exec(sql)?.[1] ?? Infinity)
  const after = /u\.id > \?/.test(sql) ? params[0] : 0
  return ALL_USERS.filter(u => u.id > after).slice(0, limit)
})
vi.mock('../../../api/lib/db.js', () => ({ query: (...a) => query(...a) }))

const pushed = []
vi.mock('../../../api/lib/pushNotifications.js', () => ({
  sendPushToUserWithStats: async id => { pushed.push(id); return { success: true, perPlatform: {} } },
  sendPushToUser: async () => ({})
}))
vi.mock('../../../api/lib/flags.js', () => ({ isFeatureEnabled: async () => true }))
vi.mock('../../../api/lib/cronRuns.js', () => ({
  createPlatformBreakdown: () => ({}),
  mergePlatformBreakdown: () => {},
  recordCronRun: vi.fn(async () => {}),
  RE_ENGAGEMENT_NUDGE_JOB: 're-engagement-nudge',
  WEEKEND_PLANS_NUDGE_JOB: 'weekend-plans-nudge'
}))
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }))

const jobs = {
  're-engagement-nudge': await import('../../../api/cron/re-engagement-nudge.js'),
  'weekend-plans-nudge': await import('../../../api/cron/weekend-plans-nudge.js')
}

function run(handler) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this },
      json(body) { resolve({ status: this.statusCode, body }); return this }
    }
    handler({ headers: { authorization: 'Bearer test-secret' } }, res)
  })
}

describe.each(Object.entries(jobs))('%s: capped, resumable runs', (name, mod) => {
  beforeEach(() => {
    kv.clear()
    kvClient = workingKv
    pushed.length = 0
    query.mockClear()
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 })
    vi.setSystemTime(new Date('2026-09-26T10:00:00Z')) // far from midnight: one cursor day
  })
  afterEach(() => vi.useRealTimers())

  const runFast = async () => {
    const p = run(mod.default)
    await vi.runAllTimersAsync()
    return p
  }

  it('sends to at most MAX_USERS_PER_RUN per run, and the next slot resumes where it stopped', async () => {
    expect(mod.MAX_USERS_PER_RUN).toBe(1000)
    await runFast()
    expect(pushed.length).toBe(1000)
    expect(query.mock.calls[0][0]).toMatch(/ORDER BY u\.id\s+LIMIT 1000/)
    await runFast()
    await runFast()
    // everyone exactly once across the three slots
    expect(pushed.length).toBe(2500)
    expect(new Set(pushed).size).toBe(2500)
    // a fourth slot the same day does nothing
    const fourth = await runFast()
    expect(fourth.body.skipped).toBe(true)
    expect(pushed.length).toBe(2500)
  })

  it('skips instead of re-sending when the cursor can\'t be read (KV down)', async () => {
    kvClient = { get: async () => { throw new Error('down') }, set: async () => 'OK' }
    const out = await runFast()
    expect(out.status).toBe(503)
    expect(pushed.length).toBe(0)
    expect(query).not.toHaveBeenCalled()
  })

  it('sends nothing if the batch can\'t be claimed (cursor write fails)', async () => {
    kvClient = { get: async () => null, set: async () => { throw new Error('down') } }
    const out = await runFast()
    expect(out.status).toBe(500)
    expect(pushed.length).toBe(0)
  })

  it('skips when KV is not configured at all', async () => {
    kvClient = null
    expect((await runFast()).status).toBe(503)
    expect(pushed.length).toBe(0)
  })
})

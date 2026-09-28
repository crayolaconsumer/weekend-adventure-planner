import { describe, it, expect, vi, beforeEach } from 'vitest'
import process from 'node:process'

// promotedEvents is the kill switch for the whole promoted-events feature: with it
// off, neither push cron may touch the DB or send a push, even with promotedEventPush on
const touched = vi.fn()
let flags
vi.mock('../../../api/lib/db.js', () => ({ query: async () => { touched(); return [] }, queryOne: async () => null, update: async () => 0, insert: async () => 0 }))
vi.mock('../../../api/lib/pushNotifications.js', () => ({ sendPushToUser: async () => { touched() }, sendPushToUserWithStats: async () => { touched(); return { success: true } } }))
vi.mock('../../../api/lib/flags.js', () => ({ isFeatureEnabled: async name => flags[name] !== false }))
vi.mock('../../../api/lib/kvCache.js', () => ({ cacheGet: async () => null, cacheSet: async () => true, getClient: () => null }))
vi.mock('../../../api/lib/cronRuns.js', async orig => ({ ...(await orig()), recordCronRun: async () => {} }))
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }))
vi.mock('../../../api/lib/promotedEventPush.js', async orig => ({ ...(await orig()), isQuietHoursUk: () => false }))

const run = async name => {
  const { default: handler } = await import(`../../../api/cron/${name}.js`)
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this }, end() { return this } }
  await handler({ method: 'GET', url: `/api/cron/${name}`, headers: { authorization: 'Bearer s3cret' } }, res)
  return res
}

describe.each(['promoted-event-push', 'local-events-digest'])('%s', name => {
  beforeEach(() => { process.env.CRON_SECRET = 's3cret'; touched.mockClear() })

  for (const [label, f] of [['promotedEvents off', { promotedEvents: false }], ['promotedEventPush off', { promotedEventPush: false }]]) {
    it(`skips without touching the DB or sending when ${label}`, async () => {
      flags = f
      const res = await run(name)
      expect(res.statusCode).toBe(200)
      expect(res.body).toMatchObject({ skipped: 'flag off' })
      expect(touched).not.toHaveBeenCalled()
    })
  }

  it('runs when both are on', async () => {
    flags = {}
    const res = await run(name)
    expect(res.statusCode).toBe(200)
    expect(res.body?.skipped).not.toBe('flag off')
    expect(touched).toHaveBeenCalled() // reached the DB
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import process from 'node:process'

// Anything a cron could touch before (or instead of) its auth check
const touched = vi.fn()
vi.mock('../../../api/lib/db.js', () => ({ query: async () => { touched(); return [] }, queryOne: async () => null, update: async () => 0, insert: async () => 0 }))
vi.mock('../../../api/lib/pushNotifications.js', () => ({ sendPushToUser: async () => { touched() }, sendPushToUserWithStats: async () => { touched(); return { success: true } }, notifyPlannedVisit: async () => { touched() }, getPlannedVisitsForToday: async () => { touched(); return [] } }))
vi.mock('../../../api/lib/flags.js', () => ({ isFeatureEnabled: async () => { touched(); return true } }))
vi.mock('../../../api/lib/kvCache.js', () => ({ cacheGet: async () => null, cacheSet: async () => true, getClient: () => null }))
vi.mock('../../../api/lib/email.js', () => ({ sendEmail: async () => ({ sent: false }) }))
vi.mock('../../../api/lib/cronRuns.js', async (orig) => ({ ...(await orig()), recordCronRun: async () => { touched() } }))
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }))

const { isAuthorizedCron } = await import('../../../api/lib/cronAuth.js')
const req = headers => ({ method: 'GET', url: '/api/cron/x', headers })

describe('isAuthorizedCron', () => {
  const saved = process.env.CRON_SECRET
  beforeEach(() => { process.env.CRON_SECRET = 's3cret' })
  afterEach(() => { if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved })

  it('accepts the Bearer secret Vercel sends', () => {
    expect(isAuthorizedCron(req({ authorization: 'Bearer s3cret' }))).toBe(true)
  })
  it('rejects the spoofable x-vercel-cron header on its own', () => {
    expect(isAuthorizedCron(req({ 'x-vercel-cron': '1' }))).toBe(false)
  })
  it('rejects a wrong or missing bearer', () => {
    expect(isAuthorizedCron(req({ authorization: 'Bearer s3cres' }))).toBe(false)
    expect(isAuthorizedCron(req({ authorization: 'Bearer s3cret ' }))).toBe(false)
    expect(isAuthorizedCron(req({}))).toBe(false)
  })
  it('fails closed when CRON_SECRET is unset (regression: "Bearer undefined" was accepted)', () => {
    delete process.env.CRON_SECRET
    expect(isAuthorizedCron(req({ authorization: 'Bearer undefined' }))).toBe(false)
    expect(isAuthorizedCron(req({ authorization: 'Bearer ' }))).toBe(false)
  })
})

describe('every cron rejects a spoofed x-vercel-cron request', () => {
  const crons = ['visit-reminders', 're-engagement-nudge', 'weekend-plans-nudge', 'prewarm-overpass', 'discover-probe', 'promoted-event-push', 'local-events-digest', 'gh-dispatch']
  beforeEach(() => { process.env.CRON_SECRET = 's3cret'; touched.mockClear() })

  it.each(crons)('%s', async name => {
    const { default: handler } = await import(`../../../api/cron/${name}.js`)
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json() { return this }, end() { return this } }
    await handler(req({ 'x-vercel-cron': '1', authorization: 'Bearer wrong' }), res)
    expect(res.statusCode).toBe(401)
    expect(touched).not.toHaveBeenCalled()
  })
})

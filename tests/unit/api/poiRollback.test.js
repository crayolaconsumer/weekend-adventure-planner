import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db, kv, resetDb } from './poiFakeDb.js'

const getUserFromRequest = vi.fn()
vi.mock('../../../api/lib/db.js', async () => (await import('./poiFakeDb.js')).dbModule)
vi.mock('../../../api/lib/kvCache.js', async () => (await import('./poiFakeDb.js')).kvModule)
vi.mock('../../../api/lib/email.js', () => ({ sendEmail: async () => ({ sent: true }) }))
vi.mock('../../../api/lib/auth.js', () => ({ getUserFromRequest: (...a) => getUserFromRequest(...a) }))

const { default: handler, ROLLBACK_SQL } = await import('../../../api/admin/poi-rollback.js')

const LIVE = 'uk-20261002T0215Z'
const PREV = 'uk-20261001T0215Z'

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined }
  res.status = c => { res.statusCode = c; return res }
  res.json = b => { res.body = b; return res }
  res.setHeader = (k, v) => { res.headers[k] = v }
  res.end = () => res
  return res
}
let ip = 0
async function call(method = 'POST', origin = 'https://go-roam.uk') {
  const headers = { 'x-forwarded-for': `10.8.${Math.floor(ip / 250)}.${ip++ % 250}`, authorization: 'Bearer jwt' }
  if (origin) headers.origin = origin
  const res = mockRes()
  await handler({ method, headers, query: {}, body: {} }, res)
  return res
}
const statusOf = id => db.builds.get(id)?.status

beforeEach(() => {
  resetDb()
  kv.gen = 3
  db.builds.set(LIVE, { status: 'active' })
  db.builds.set(PREV, { status: 'previous' })
  db.tables.pois.comment = LIVE
  db.tables.poi_photos.comment = LIVE
  db.tables.pois_prev = db.newTable(PREV)
  db.tables.poi_photos_prev = db.newTable(PREV)
  getUserFromRequest.mockReset().mockResolvedValue({ id: 1, is_admin: true })
})
afterEach(() => {
  expect(db.lockHeld === null || db.lockHeld === 'other').toBe(true)
  expect(db.closed).toBe(db.opened)
})

describe('/api/admin/poi-rollback', () => {
  it('404s non-admins and foreign origins before any SQL', async () => {
    getUserFromRequest.mockResolvedValue({ id: 2, is_admin: false })
    expect((await call()).statusCode).toBe(404)
    getUserFromRequest.mockResolvedValue({ id: 1, is_admin: true })
    expect((await call('POST', 'https://evil.example')).statusCode).toBe(404)
    getUserFromRequest.mockResolvedValue(null)
    expect((await call()).statusCode).toBe(404)
    expect(db.log).toEqual([])
  })

  it('renames the previous build back live under the loader lock, keeping the replaced one as *_failed', async () => {
    const res = await call()
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ rolled_back: LIVE, active: PREV, poi_gen: 4 })
    expect(db.log).toContain('SELECT GET_LOCK(?, 0) AS got')
    expect(db.log).toContain('SET SESSION wait_timeout = 150, lock_wait_timeout = 5')
    const ddl = db.log.filter(s => /^(DROP|RENAME)/.test(s))
    expect(ddl).toEqual(ROLLBACK_SQL)
    expect(db.connLog.filter(s => /^(DROP|RENAME)/.test(s))).toEqual(ROLLBACK_SQL)
    expect(ROLLBACK_SQL).toEqual([
      'DROP TABLE IF EXISTS pois_failed, poi_photos_failed',
      'RENAME TABLE pois TO pois_failed, pois_prev TO pois, poi_photos TO poi_photos_failed, poi_photos_prev TO poi_photos',
    ])
    expect([db.tables.pois.comment, db.tables.pois_failed.comment]).toEqual([PREV, LIVE])
    expect([statusOf(PREV), statusOf(LIVE)]).toEqual(['active', 'rolled_back'])
    expect(kv.incrs).toEqual(['roam:poiGen'])
    expect(kv.writes).toEqual([])
    expect(db.builds.get(PREV).gen_pending).toBe(0)
    expect(db.log.findIndex(s => s.includes('gen_pending = 1'))).toBeLessThan(db.log.findIndex(s => s.startsWith('RENAME')))
  })

  it('after the first ever build there is nothing to roll back to (pois_prev is the empty migration table)', async () => {
    db.tables.pois_prev.comment = ''
    db.tables.poi_photos_prev.comment = ''
    db.builds.delete(PREV)
    const res = await call()
    expect(res.statusCode).toBe(409)
    expect(db.log.some(s => /^(DROP|RENAME)/.test(s))).toBe(false)
    expect(db.tables.pois.comment).toBe(LIVE)
  })

  it('refuses a pois_prev whose photos twin or poi_builds row does not match', async () => {
    db.tables.poi_photos_prev.comment = 'uk-20260101T0215Z'
    expect((await call()).statusCode).toBe(409)
    db.tables.poi_photos_prev.comment = PREV
    db.builds.get(PREV).status = 'failed'
    expect((await call()).statusCode).toBe(409)
    expect(db.log.some(s => /^(DROP|RENAME)/.test(s))).toBe(false)
  })

  it('a missed INCR is retried by the next rollback call', async () => {
    kv.incrError = new Error('upstash down')
    expect((await call()).body.poi_gen).toBeNull()
    expect(db.builds.get(PREV).gen_pending).toBe(1)
    kv.incrError = null
    expect((await call()).statusCode).toBe(409) // nothing left to roll back, but recovery ran first
    expect(kv.incrs).toEqual(['roam:poiGen'])
    expect(db.builds.get(PREV).gen_pending).toBe(0)
  })

  it('a failed poiGen bump does not undo the rollback', async () => {
    kv.incrError = new Error('upstash down')
    const res = await call()
    expect(res.statusCode).toBe(200)
    expect(res.body.poi_gen).toBeNull()
    expect(db.tables.pois.comment).toBe(PREV)
  })

  it('waits for no load: a held loader lock is a retryable 409', async () => {
    db.lockHeld = 'other'
    const res = await call()
    expect(res.statusCode).toBe(409)
    expect(res.body.retry).toBe(true)
    expect(db.log.some(s => /^(DROP|RENAME)/.test(s))).toBe(false)
  })

  it('a RENAME blocked by readers is a 503 with Retry-After, tables untouched', async () => {
    db.fail.push({ re: /^RENAME/, err: Object.assign(new Error('Lock wait timeout exceeded'), { errno: 1205 }) })
    const res = await call()
    expect(res.statusCode).toBe(503)
    expect(res.headers['Retry-After']).toBe('5')
    expect([db.tables.pois.comment, db.tables.pois_prev.comment]).toEqual([LIVE, PREV])
    expect(statusOf(LIVE)).toBe('active')
  })

  it('a crash after its RENAME is repaired by the next call from the table COMMENTs', async () => {
    db.fail.push({ re: /status = CASE/, once: true, err: new Error('connection lost') })
    expect((await call()).statusCode).toBe(500)
    expect(db.tables.pois.comment).toBe(PREV)
    expect(statusOf(LIVE)).toBe('active') // stale
    const res = await call() // nothing left to roll back to, but reconcile runs first
    expect(res.statusCode).toBe(409)
    expect([statusOf(PREV), statusOf(LIVE)]).toEqual(['active', 'rolled_back'])
  })

  it('409s with nothing to roll back to, and renames nothing', async () => {
    delete db.tables.poi_photos_prev
    expect((await call()).statusCode).toBe(409)
    expect(db.log.some(s => /^(DROP|RENAME)/.test(s))).toBe(false)
    expect(kv.incrs).toEqual([])
  })

  it('a 500 carries only a request id', async () => {
    db.fail.push({ re: /^DROP/, err: new Error('secret-db.rds.amazonaws.com unreachable') })
    const res = await call()
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Rollback failed', request_id: expect.any(String) })
  })

  it('GET lists recent builds and changes nothing', async () => {
    const res = await call('GET')
    expect(res.statusCode).toBe(200)
    expect(res.body.builds.map(b => b.build_id)).toEqual([LIVE, PREV])
    expect(db.log.some(s => /^(DROP|RENAME|UPDATE)/.test(s))).toBe(false)
  })
})

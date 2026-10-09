import { describe, it, expect, vi, beforeEach } from 'vitest'

// Regression: idle connections survived Fluid compute suspension (idleTimeout
// can't run while paused), so one session across ~17 endpoints held 51 DB
// connections against a ~60 limit. The pool must be attached so Vercel
// releases idle connections before suspending the instance.
const attach = vi.fn()
const inner = { on: vi.fn(), config: { idleTimeout: 10000, connectionConfig: {} } }
const fakeConn = { query: vi.fn(), release: vi.fn(), destroy: vi.fn() }
const fakePool = {
  query: vi.fn(),
  execute: vi.fn(),
  pool: inner,
  getConnection: vi.fn(() => Promise.resolve(fakeConn)),
}
vi.mock('@vercel/functions', () => ({ attachDatabasePool: (p) => attach(p), waitUntil: () => {} }))
vi.mock('mysql2/promise', () => ({ default: { createPool: vi.fn(() => fakePool) } }))

describe('db pool', () => {
  it('attaches the pool to Vercel once, however often it is fetched', async () => {
    const { getPool } = await import('../../../api/lib/db.js')
    expect(getPool()).toBe(fakePool)
    getPool()
    expect(attach).toHaveBeenCalledTimes(1)
    // the callback pool inside mysql2/promise: the promise wrapper is rejected
    expect(attach).toHaveBeenCalledWith(inner)
  })
})

describe('query timeout (a stuck query must free the pool connection)', () => {
  beforeEach(() => {
    fakeConn.query.mockReset()
    fakeConn.release.mockClear()
    fakeConn.destroy.mockClear()
  })

  it('passes a per-query timeout to the connection and releases it on success', async () => {
    const { query } = await import('../../../api/lib/db.js')
    fakeConn.query.mockResolvedValue([[{ n: 1 }], []])
    await query('SELECT 1 n')
    expect(fakeConn.query).toHaveBeenCalledTimes(1)
    const [opts] = fakeConn.query.mock.calls[0]
    expect(opts).toMatchObject({ sql: 'SELECT 1 n', values: [] })
    expect(typeof opts.timeout).toBe('number')
    expect(opts.timeout).toBeGreaterThan(0)
    expect(fakeConn.release).toHaveBeenCalledTimes(1)
    expect(fakeConn.destroy).not.toHaveBeenCalled()
  })

  it('destroys the connection on timeout so the pool slot is freed for the next request', async () => {
    const { query } = await import('../../../api/lib/db.js')
    fakeConn.query.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'PROTOCOL_SEQUENCE_TIMEOUT' }))
    await expect(query('SELECT SLEEP(60)')).rejects.toMatchObject({ code: 'PROTOCOL_SEQUENCE_TIMEOUT' })
    // destroy, not release: a released connection is still wedged on the
    // stuck query, so the next request would inherit the hang
    expect(fakeConn.destroy).toHaveBeenCalledTimes(1)
    expect(fakeConn.release).not.toHaveBeenCalled()
  })

  it('releases (not destroys) the connection on ordinary errors', async () => {
    const { query } = await import('../../../api/lib/db.js')
    fakeConn.query.mockRejectedValue(Object.assign(new Error('bad table'), { code: 'ER_BAD_TABLE_ERROR' }))
    await expect(query('SELECT 1')).rejects.toMatchObject({ code: 'ER_BAD_TABLE_ERROR' })
    expect(fakeConn.release).toHaveBeenCalledTimes(1)
    expect(fakeConn.destroy).not.toHaveBeenCalled()
  })

  it('queryOne, insert and update all route through the timed query', async () => {
    const { queryOne, insert, update } = await import('../../../api/lib/db.js')
    fakeConn.query.mockReset()
    fakeConn.query.mockResolvedValueOnce([[{ a: 1 }], []])
    fakeConn.query.mockResolvedValueOnce([{ insertId: 7 }])
    fakeConn.query.mockResolvedValueOnce([{ affectedRows: 3 }])
    await expect(queryOne('SELECT 1 a')).resolves.toEqual({ a: 1 })
    await expect(insert('INSERT')).resolves.toBe(7)
    await expect(update('UPDATE')).resolves.toBe(3)
    for (const [opts] of fakeConn.query.mock.calls) expect(opts.timeout).toBeGreaterThan(0)
  })
})

describe('pause survivors and failed connects (regression: woken instances, 8 Oct)', () => {
  const conn = () => ({ query: vi.fn(async () => [[{ n: 1 }], []]), release: vi.fn(), destroy: vi.fn() })
  beforeEach(() => fakePool.getConnection.mockReset())

  it('a connection idle past the reaper (it outlived a Fluid pause) is replaced before the query', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const { query } = await import('../../../api/lib/db.js')
      const old = conn(), fresh = conn()
      fakePool.getConnection.mockResolvedValueOnce(old).mockResolvedValueOnce(old).mockResolvedValueOnce(fresh)
      await query('SELECT 1') // old goes back to the pool
      vi.setSystemTime(Date.now() + 60_000) // the instance slept
      await query('SELECT 2')
      expect(old.destroy).toHaveBeenCalledTimes(1)
      expect(old.query).toHaveBeenCalledTimes(1)
      expect(fresh.query).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a recently used connection is reused as is', async () => {
    const { query } = await import('../../../api/lib/db.js')
    const c = conn()
    fakePool.getConnection.mockResolvedValue(c)
    await query('SELECT 1')
    await query('SELECT 2')
    expect(c.destroy).not.toHaveBeenCalled()
    expect(c.query).toHaveBeenCalledTimes(2)
  })

  it('a connect that times out gets one more try (nothing ran, so writes are safe too)', async () => {
    const { insert } = await import('../../../api/lib/db.js')
    const c = conn()
    c.query.mockResolvedValue([{ insertId: 9 }])
    fakePool.getConnection.mockRejectedValueOnce(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })).mockResolvedValueOnce(c)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(insert('INSERT INTO t VALUES (1)')).resolves.toBe(9)
    expect(c.query).toHaveBeenCalledTimes(1)
  })

  it('other connect errors are not retried, and a second connect failure is thrown', async () => {
    const { query } = await import('../../../api/lib/db.js')
    fakePool.getConnection.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'ER_ACCESS_DENIED_ERROR' }))
    await expect(query('SELECT 1')).rejects.toMatchObject({ code: 'ER_ACCESS_DENIED_ERROR' })
    expect(fakePool.getConnection).toHaveBeenCalledTimes(1)
    const timedOut = () => Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })
    fakePool.getConnection.mockRejectedValueOnce(timedOut()).mockRejectedValueOnce(timedOut())
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(query('SELECT 1')).rejects.toMatchObject({ code: 'ETIMEDOUT' })
    expect(fakePool.getConnection).toHaveBeenCalledTimes(3)
  })
})

it('the real mysql2 promise pool exposes a pool Vercel accepts', async () => {
  vi.doUnmock('@vercel/functions'); vi.doUnmock('mysql2/promise'); vi.resetModules()
  const mysql = (await import('mysql2/promise')).default
  const { attachDatabasePool } = await import('@vercel/functions')
  const p = mysql.createPool({ host: '127.0.0.1', user: 'x', connectionLimit: 1 })
  expect(() => attachDatabasePool(p.pool)).not.toThrow()
  expect(() => attachDatabasePool(p)).toThrow()
  await p.end()
})

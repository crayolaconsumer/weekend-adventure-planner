import { describe, it, expect, vi } from 'vitest'

// Regression: idle connections survived Fluid compute suspension (idleTimeout
// can't run while paused), so one session across ~17 endpoints held 51 DB
// connections against a ~60 limit. The pool must be attached so Vercel
// releases idle connections before suspending the instance.
const attach = vi.fn()
const inner = { on: vi.fn() }
const fakePool = { query: vi.fn(), execute: vi.fn(), pool: inner }
vi.mock('@vercel/functions', () => ({ attachDatabasePool: (p) => attach(p) }))
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

it('the real mysql2 promise pool exposes a pool Vercel accepts', async () => {
  vi.doUnmock('@vercel/functions'); vi.doUnmock('mysql2/promise'); vi.resetModules()
  const mysql = (await import('mysql2/promise')).default
  const { attachDatabasePool } = await import('@vercel/functions')
  const p = mysql.createPool({ host: '127.0.0.1', user: 'x', connectionLimit: 1 })
  expect(() => attachDatabasePool(p.pool)).not.toThrow()
  expect(() => attachDatabasePool(p)).toThrow()
  await p.end()
})

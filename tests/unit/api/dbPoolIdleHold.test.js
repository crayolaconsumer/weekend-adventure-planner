// @vitest-environment node
import { it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Regression: attachDatabasePool held every DB invocation 60.1 s, timing out maxDuration-60 functions

afterEach(() => {
  vi.restoreAllMocks()
  delete globalThis[Symbol.for('@vercel/request-context')]
})

it('after a query, Vercel holds the invocation just long enough to close the idle connection', async () => {
  vi.stubEnv('VERCEL_URL', 'x.vercel.app')
  vi.stubEnv('VERCEL_REGION', 'lhr1')
  vi.stubEnv('MYSQL_HOST', '127.0.0.1')
  const held = []
  globalThis[Symbol.for('@vercel/request-context')] = { get: () => ({ waitUntil: p => held.push(p) }) }
  const timers = vi.spyOn(globalThis, 'setTimeout')

  const { getPool } = await import('../../../api/lib/db.js')
  const pool = getPool()
  timers.mockClear()
  pool.pool.emit('release', {})

  expect(held).toHaveLength(1)
  const holdMs = timers.mock.calls.map(c => c[1]).find(ms => ms > 1000)
  // mysql2 only reaps idle connections when maxIdle < connectionLimit, on 1 s ticks: the hold covers one
  expect(pool.pool.config.maxIdle).toBeLessThan(pool.pool.config.connectionLimit)
  expect(holdMs).toBeGreaterThan(1000)
  expect(holdMs).toBeLessThanOrEqual(2000)

  const fns = Object.values(JSON.parse(readFileSync('vercel.json', 'utf8')).functions)
  const shortest = Math.min(...fns.map(f => f.maxDuration).filter(Boolean)) * 1000
  expect(holdMs).toBeLessThan(shortest)

  await pool.end()
})

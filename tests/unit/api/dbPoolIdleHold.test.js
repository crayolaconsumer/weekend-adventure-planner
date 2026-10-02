// @vitest-environment node
import { it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Regression: attachDatabasePool held every DB invocation 60.1 s, timing out maxDuration-60 functions

afterEach(() => {
  vi.restoreAllMocks()
  delete globalThis[Symbol.for('@vercel/request-context')]
})

it('after a query, Vercel holds the invocation for the pool idle time, not 60 s', async () => {
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
  expect(holdMs).toBe(pool.pool.config.idleTimeout + 100)

  const fns = Object.values(JSON.parse(readFileSync('vercel.json', 'utf8')).functions)
  const shortest = Math.min(...fns.map(f => f.maxDuration).filter(Boolean)) * 1000
  expect(holdMs).toBeLessThan(shortest)

  await pool.end()
})

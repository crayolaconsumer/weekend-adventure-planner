import { describe, it, expect, vi } from 'vitest'
import process from 'node:process'

const createPool = vi.fn(() => ({ query: vi.fn() }))
vi.mock('mysql2/promise', () => ({ default: { createPool } }))

describe('db pool budget', () => {
  it('keeps each instance to a small, self-releasing pool', async () => {
    const { getPool } = await import('../../../api/lib/db.js')
    getPool()
    getPool()
    expect(createPool).toHaveBeenCalledTimes(1) // one pool per instance
    const cfg = createPool.mock.calls[0][0]
    // 3 per instance x peak warm instances must stay under max_connections
    expect(cfg.connectionLimit).toBe(3)
    expect(cfg.queueLimit).toBeGreaterThan(0) // bounded, never 0 (= unbounded)
    expect(cfg.connectTimeout).toBeLessThanOrEqual(5000)
    // mysql2 only runs its idle reaper when maxIdle < connectionLimit
    expect(cfg.maxIdle).toBeLessThan(cfg.connectionLimit)
    expect(cfg.idleTimeout).toBeLessThanOrEqual(10000)
  })
})

describe('vercel.json regions', () => {
  it('pins every function to lhr1, next to the London database', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const cfg = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'))
    expect(cfg.regions).toEqual(['lhr1'])
    for (const [path, fn] of Object.entries(cfg.functions || {})) expect(fn.regions, path).toBeUndefined()
  })
})

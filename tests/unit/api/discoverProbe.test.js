import { describe, it, expect, vi } from 'vitest'
import process from 'node:process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('../../../api/lib/cronRuns.js', () => ({ recordCronRun: async () => {} }))
vi.mock('../../../api/lib/email.js', () => ({ sendEmail: async () => ({ sent: false }) }))
vi.mock('../../../api/lib/kvCache.js', () => ({ cacheGet: async () => null, cacheSet: async () => true }))

const { citiesForRun, CITIES_PER_RUN } = await import('../../../api/cron/discover-probe.js')

describe('discover-probe rotation', () => {
  const TWO_H = 2 * 60 * 60 * 1000
  it('probes 2 cities per run and covers all 4 across two consecutive runs', () => {
    const t = Date.parse('2026-09-27T10:13:00Z')
    const a = citiesForRun(t).map(c => c.name)
    const b = citiesForRun(t + TWO_H).map(c => c.name)
    expect(CITIES_PER_RUN).toBe(2)
    expect(a).toHaveLength(2)
    expect(b).toHaveLength(2)
    expect(new Set([...a, ...b]).size).toBe(4)
    expect(citiesForRun(t + 2 * TWO_H).map(c => c.name)).toEqual(a)
  })

  it('is scheduled every 2 hours, not every 30 minutes', () => {
    const cfg = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'))
    expect(cfg.crons.find(c => c.path === '/api/cron/discover-probe').schedule).toBe('13 */2 * * *')
  })
})

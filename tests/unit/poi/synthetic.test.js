// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { judge, CHECKS, YORK } from '../../../scripts/monitor/synthetic.mjs'
import { parseQuery } from '../../../api/lib/poiQuery.js'
import { snapQueryBbox } from '../../../api/lib/bboxSnap.js'
import { hashKey } from '../../../api/lib/kvCache.js'

const check = { name: 'x', maxMs: 1000, expect: true }
describe('synthetic monitor verdicts', () => {
  it('passes if any attempt was a fast 200 with the expected body', () => {
    expect(judge(check, [{ status: 503, ms: 50 }, { status: 200, ms: 300, ok: true }])).toMatchObject({ ok: true, ms: 300 })
  })
  it('fails with the reason from the last attempt', () => {
    expect(judge(check, [{ status: 200, ms: 50, ok: true }].map(a => ({ ...a, status: 500 })))).toMatchObject({ ok: false, why: 'HTTP 500' })
    expect(judge(check, [{ status: 200, ms: 1500, ok: true }])).toMatchObject({ ok: false, why: 'slow 1500 ms > 1000' })
    expect(judge(check, [{ status: 200, ms: 100, ok: false }])).toMatchObject({ ok: false, why: 'unexpected body' })
    expect(judge(check, [{ status: 0, ms: 9000, ok: false, error: 'TimeoutError' }])).toMatchObject({ ok: false, why: 'TimeoutError' })
  })
  it('health demands db AND kv ok; discover demands places', () => {
    const health = CHECKS.find(c => c.name === 'health')
    expect(health.expect({ db: 'ok', kv: 'ok' })).toBe(true)
    expect(health.expect({ db: 'ok', kv: 'fail' })).toBe(false)
    const discover = CHECKS.find(c => c.name === 'discover')
    expect(discover.expect({ elements: [] })).toBe(false)
    expect(discover.expect({ elements: [{}] })).toBe(true)
  })

  // Critic: the first probe query couldn't be DB-served, so a daily KV miss
  // went live to public Overpass (and paged on the 15-25 s wait)
  it('the Discover probe is DB-answerable in the lowest rollout bucket', () => {
    const snapped = snapQueryBbox(YORK)
    expect(parseQuery(snapped)).not.toBeNull()
    expect(parseInt(hashKey(snapped).slice(0, 8), 16) % 100).toBeLessThanOrEqual(5)
  })
})

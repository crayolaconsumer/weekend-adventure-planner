import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dropRateLimitHeaders } from '../../../api/lib/rateLimit.js'

// A CDN-cached (public, s-maxage) response is served to everyone, so the
// per-visitor X-RateLimit-* counters set by the rate limiter must be dropped
// first, or every viewer sees one IP's "Remaining" count.
describe('rate-limit headers on publicly cached responses', () => {
  it('dropRateLimitHeaders removes all three', () => {
    const headers = { 'X-RateLimit-Limit': 60, 'X-RateLimit-Remaining': 12, 'X-RateLimit-Reset': 1, 'Content-Type': 'x' }
    dropRateLimitHeaders({ removeHeader: k => delete headers[k] })
    expect(headers).toEqual({ 'Content-Type': 'x' })
  })

  it('every rate-limited route that caches publicly drops them', () => {
    const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [] })
    const offenders = walk('api').filter(f => {
      if (f.includes('/lib/')) return false
      const src = readFileSync(f, 'utf8')
      return /apply(Shared)?RateLimit\(/.test(src) && /s-maxage/.test(src) && !/dropRateLimitHeaders\(res\)|forwardImageResponse|renderOgCard/.test(src)
    })
    expect(offenders).toEqual([])
  })
})

import { describe, it, expect, vi } from 'vitest'
import { RATE_LIMITS, checkRateLimit, getRateLimitKey, applyRateLimit, applySharedRateLimit } from '../../../api/lib/rateLimit.js'

// The rate limiter uses a module-level Map. To keep tests isolated we
// use a fresh unique key per test (timestamp + random) so windows don't
// leak between tests.
const uniqueKey = () => `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

describe('rateLimit.checkRateLimit', () => {
  it('allows requests under the limit and decrements remaining', () => {
    const key = uniqueKey()
    const config = { windowMs: 60 * 1000, max: 3 }

    const r1 = checkRateLimit(key, config)
    expect(r1.allowed).toBe(true)
    expect(r1.remaining).toBe(2)

    const r2 = checkRateLimit(key, config)
    expect(r2.allowed).toBe(true)
    expect(r2.remaining).toBe(1)

    const r3 = checkRateLimit(key, config)
    expect(r3.allowed).toBe(true)
    expect(r3.remaining).toBe(0)

    // 4th request denied
    const r4 = checkRateLimit(key, config)
    expect(r4.allowed).toBe(false)
  })

  it('applies a block window after exceeding max', () => {
    const key = uniqueKey()
    const config = { windowMs: 60 * 1000, max: 1, blockDurationMs: 5 * 60 * 1000 }

    checkRateLimit(key, config) // ok
    const denied = checkRateLimit(key, config) // exceeds
    expect(denied.allowed).toBe(false)
    expect(denied.blocked).toBe(true)
    expect(denied.retryAfter).toBeGreaterThan(0)
  })

  it('resets after window expires', () => {
    const key = uniqueKey()
    const config = { windowMs: 100, max: 1 }

    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-05-14T00:00:00Z'))
      checkRateLimit(key, config)
      vi.setSystemTime(new Date('2026-05-14T00:00:00.500Z'))
      // After window: should allow again
      const after = checkRateLimit(key, config)
      expect(after.allowed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('respects blockedUntil even after window would have rolled', () => {
    const key = uniqueKey()
    const config = { windowMs: 100, max: 1, blockDurationMs: 10 * 60 * 1000 }

    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-05-14T00:00:00Z'))
      checkRateLimit(key, config)
      checkRateLimit(key, config) // triggers block

      // Advance past window but well within block
      vi.setSystemTime(new Date('2026-05-14T00:00:00.500Z'))
      const stillBlocked = checkRateLimit(key, config)
      expect(stillBlocked.allowed).toBe(false)
      expect(stillBlocked.blocked).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('rateLimit.getRateLimitKey', () => {
  it('prefers X-Forwarded-For first hop', () => {
    const req = { headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' } }
    expect(getRateLimitKey(req)).toBe('203.0.113.1')
  })

  it('falls back to X-Real-IP', () => {
    const req = { headers: { 'x-real-ip': '203.0.113.2' } }
    expect(getRateLimitKey(req)).toBe('203.0.113.2')
  })

  it('falls back to socket remoteAddress', () => {
    const req = { headers: {}, socket: { remoteAddress: '203.0.113.3' } }
    expect(getRateLimitKey(req)).toBe('203.0.113.3')
  })

  it("falls back to 'unknown' when no signal", () => {
    expect(getRateLimitKey({ headers: {} })).toBe('unknown')
  })

  it('appends suffix when provided', () => {
    const req = { headers: { 'x-real-ip': '1.2.3.4' } }
    expect(getRateLimitKey(req, 'login')).toBe('1.2.3.4:login')
  })
})

describe('rateLimit.applyRateLimit', () => {
  function mockRes() {
    const headers = {}
    return {
      headers,
      setHeader: (k, v) => { headers[k] = v },
    }
  }

  it('sets standard rate-limit headers on every call', () => {
    const key = uniqueKey()
    const req = { headers: { 'x-real-ip': key } }
    const res = mockRes()
    applyRateLimit(req, res, { windowMs: 60 * 1000, max: 5 })
    expect(res.headers['X-RateLimit-Limit']).toBe(5)
    expect(res.headers['X-RateLimit-Remaining']).toBe(4)
    expect(typeof res.headers['X-RateLimit-Reset']).toBe('number')
  })

  it('returns null when allowed', () => {
    const req = { headers: { 'x-real-ip': uniqueKey() } }
    expect(applyRateLimit(req, mockRes(), { windowMs: 60 * 1000, max: 5 })).toBe(null)
  })

  it('returns 429 error when over limit, with Retry-After', () => {
    const key = uniqueKey()
    const req = { headers: { 'x-real-ip': key } }
    const config = { windowMs: 60 * 1000, max: 1, blockDurationMs: 60 * 1000 }
    applyRateLimit(req, mockRes(), config) // first ok
    const res = mockRes()
    const denied = applyRateLimit(req, res, config) // exceeds
    expect(denied.status).toBe(429)
    expect(denied.retryAfter).toBeGreaterThan(0)
    expect(res.headers['Retry-After']).toBe(denied.retryAfter)
  })
})

describe('rateLimit.RATE_LIMITS presets', () => {
  it('exposes expected named presets', () => {
    const required = [
      'AUTH_LOGIN', 'AUTH_REGISTER', 'AUTH_GOOGLE',
      'SHARE_CODE_LOOKUP', 'API_GENERAL', 'API_WRITE',
      'CONTRIBUTION', 'VOTE', 'FOLLOW',
    ]
    for (const k of required) {
      expect(RATE_LIMITS).toHaveProperty(k)
      expect(typeof RATE_LIMITS[k].windowMs).toBe('number')
      expect(typeof RATE_LIMITS[k].max).toBe('number')
    }
  })

  it('auth-write presets are tighter than general API', () => {
    expect(RATE_LIMITS.AUTH_LOGIN.max).toBeLessThan(RATE_LIMITS.API_GENERAL.max)
    expect(RATE_LIMITS.AUTH_REGISTER.max).toBeLessThan(RATE_LIMITS.AUTH_LOGIN.max)
  })
})

describe('rateLimit.applySharedRateLimit (KV, across instances)', () => {
  // Minimal Upstash stand-in: pipeline().incr().expire().exec()
  function fakeKv() {
    const counts = new Map()
    const ttls = new Map()
    return {
      counts, ttls,
      pipeline() {
        const ops = []
        const p = {
          incr(k) { ops.push(() => { counts.set(k, (counts.get(k) || 0) + 1); return counts.get(k) }); return p },
          expire(k, s) { ops.push(() => { ttls.set(k, s); return 1 }); return p },
          exec: async () => ops.map(op => op())
        }
        return p
      }
    }
  }
  const reqFrom = ip => ({ headers: { 'x-forwarded-for': ip } })
  const fakeRes = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v } })

  it('allows up to max per window per IP, then 429s with Retry-After', async () => {
    const kv = fakeKv()
    const cfg = { max: 3, windowSec: 60 }
    for (let i = 0; i < 3; i++) expect(await applySharedRateLimit(reqFrom('1.1.1.1'), fakeRes(), cfg, 't', kv)).toBe(null)
    const res = fakeRes()
    const limited = await applySharedRateLimit(reqFrom('1.1.1.1'), res, cfg, 't', kv)
    expect(limited).toMatchObject({ status: 429 })
    expect(res.headers['Retry-After']).toBeGreaterThan(0)
    expect(res.headers['Retry-After']).toBeLessThanOrEqual(60)
    // another IP is unaffected
    expect(await applySharedRateLimit(reqFrom('2.2.2.2'), fakeRes(), cfg, 't', kv)).toBe(null)
  })

  it('always sets a TTL so window keys expire', async () => {
    const kv = fakeKv()
    await applySharedRateLimit(reqFrom('1.1.1.1'), fakeRes(), { max: 5, windowSec: 60 }, 'ttl', kv)
    expect([...kv.ttls.values()]).toEqual([60])
    expect([...kv.ttls.keys()][0]).toMatch(/^rl:ttl:1\.1\.1\.1:\d+$/)
  })

  it('starts a fresh count in the next window', async () => {
    vi.useFakeTimers()
    try {
      const kv = fakeKv()
      const cfg = { max: 1, windowSec: 60 }
      vi.setSystemTime(new Date('2026-09-27T10:00:05Z'))
      await applySharedRateLimit(reqFrom('1.1.1.1'), fakeRes(), cfg, 'w', kv)
      expect(await applySharedRateLimit(reqFrom('1.1.1.1'), fakeRes(), cfg, 'w', kv)).not.toBe(null)
      vi.setSystemTime(new Date('2026-09-27T10:01:01Z'))
      expect(await applySharedRateLimit(reqFrom('1.1.1.1'), fakeRes(), cfg, 'w', kv)).toBe(null)
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails open when KV errors or is not configured', async () => {
    const broken = { pipeline: () => ({ incr() { return this }, expire() { return this }, exec: async () => { throw new Error('down') } }) }
    expect(await applySharedRateLimit(reqFrom('1.1.1.1'), fakeRes(), { max: 0, windowSec: 60 }, 'x', broken)).toBe(null)
    expect(await applySharedRateLimit(reqFrom('1.1.1.1'), fakeRes(), { max: 0, windowSec: 60 }, 'x', null)).toBe(null)
  })
})

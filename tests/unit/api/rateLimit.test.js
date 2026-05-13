import { describe, it, expect, vi } from 'vitest'
import { RATE_LIMITS, checkRateLimit, getRateLimitKey, applyRateLimit } from '../../../api/lib/rateLimit.js'

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

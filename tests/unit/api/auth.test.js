import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isValidEmail, validatePassword, isPremiumUser, getUserLimits, extractToken } from '../../../api/lib/auth.js'

describe('isValidEmail', () => {
  it('accepts well-formed emails', () => {
    expect(isValidEmail('a@b.com')).toBe(true)
    expect(isValidEmail('user.name+tag@example.co.uk')).toBe(true)
  })

  it('rejects missing @ / TLD', () => {
    expect(isValidEmail('not-an-email')).toBe(false)
    expect(isValidEmail('foo@bar')).toBe(false)
    expect(isValidEmail('@example.com')).toBe(false)
    expect(isValidEmail('foo@.com')).toBe(false)
  })

  it('rejects whitespace', () => {
    expect(isValidEmail('foo @bar.com')).toBe(false)
    expect(isValidEmail('foo@bar .com')).toBe(false)
  })

  it('rejects empty', () => {
    expect(isValidEmail('')).toBe(false)
  })
})

describe('validatePassword', () => {
  it('rejects short passwords', () => {
    expect(validatePassword('Abc1').valid).toBe(false)
    expect(validatePassword('').valid).toBe(false)
  })

  it('requires at least 8 chars', () => {
    expect(validatePassword('Aa1').valid).toBe(false)
    expect(validatePassword('Aa1!Bc2!').valid).toBe(true)
  })

  it('requires lowercase / uppercase / digit', () => {
    expect(validatePassword('ABCDEFGH').valid).toBe(false) // no lower / digit
    expect(validatePassword('abcdefgh').valid).toBe(false) // no upper / digit
    expect(validatePassword('Abcdefgh').valid).toBe(false) // no digit
    expect(validatePassword('Abcdefg1').valid).toBe(true)
  })

  it('rejects nullish', () => {
    expect(validatePassword(null).valid).toBe(false)
    expect(validatePassword(undefined).valid).toBe(false)
  })
})

describe('isPremiumUser', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-14T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns false for null/undefined', () => {
    expect(isPremiumUser(null)).toBe(false)
    expect(isPremiumUser(undefined)).toBe(false)
  })

  it('returns false for non-premium tier', () => {
    expect(isPremiumUser({ tier: 'free' })).toBe(false)
  })

  it('returns true for premium with no expiry', () => {
    expect(isPremiumUser({ tier: 'premium' })).toBe(true)
    expect(isPremiumUser({ tier: 'premium', subscription_expires_at: null })).toBe(true)
  })

  it('returns true for premium expiring in the future', () => {
    expect(isPremiumUser({
      tier: 'premium',
      subscription_expires_at: '2026-06-01T00:00:00Z',
    })).toBe(true)
  })

  it('returns false for premium expired in the past', () => {
    expect(isPremiumUser({
      tier: 'premium',
      subscription_expires_at: '2026-01-01T00:00:00Z',
    })).toBe(false)
  })
})

describe('getUserLimits', () => {
  it('returns Infinity for premium users', () => {
    const limits = getUserLimits({ tier: 'premium' })
    expect(limits.maxSavedPlaces).toBe(Infinity)
    expect(limits.maxCollections).toBe(Infinity)
  })

  it('returns free-tier caps for non-premium', () => {
    const limits = getUserLimits({ tier: 'free' })
    expect(limits.maxSavedPlaces).toBe(10)
    expect(limits.maxCollections).toBe(3)
    expect(limits.maxSavedEvents).toBe(10)
  })

  it('returns free-tier caps for null user', () => {
    const limits = getUserLimits(null)
    expect(limits.maxSavedPlaces).toBe(10)
  })
})

describe('extractToken', () => {
  it('reads Authorization Bearer header', () => {
    const req = { headers: { authorization: 'Bearer abc123' } }
    expect(extractToken(req)).toBe('abc123')
  })

  it('reads cookie token', () => {
    const req = { headers: { cookie: 'roam_token=def456; other=ignored' } }
    expect(extractToken(req)).toBe('def456')
  })

  it("prefers Authorization header over cookie", () => {
    const req = {
      headers: {
        authorization: 'Bearer header-token',
        cookie: 'roam_token=cookie-token',
      },
    }
    expect(extractToken(req)).toBe('header-token')
  })

  it('returns null when neither present', () => {
    expect(extractToken({ headers: {} })).toBe(null)
  })

  it('rejects malformed Authorization (no Bearer prefix)', () => {
    const req = { headers: { authorization: 'abc123' } }
    expect(extractToken(req)).toBe(null)
  })
})

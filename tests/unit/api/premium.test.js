import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isPremiumRow, isPremiumSql } from '../../../api/lib/premium.js'

describe('isPremiumRow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-14T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns false for null/undefined', () => {
    expect(isPremiumRow(null)).toBe(false)
    expect(isPremiumRow(undefined)).toBe(false)
  })

  it('returns false when tier !== premium', () => {
    expect(isPremiumRow({ tier: 'free' })).toBe(false)
    expect(isPremiumRow({ tier: null })).toBe(false)
  })

  it('returns true for premium with null expiry (lifetime/comped)', () => {
    expect(isPremiumRow({ tier: 'premium', subscription_expires_at: null })).toBe(true)
    expect(isPremiumRow({ tier: 'premium' })).toBe(true)
  })

  it('returns true for premium with future expiry (snake_case)', () => {
    expect(
      isPremiumRow({
        tier: 'premium',
        subscription_expires_at: new Date('2026-06-01T00:00:00Z').toISOString(),
      }),
    ).toBe(true)
  })

  it('returns true for premium with future expiry (camelCase)', () => {
    expect(
      isPremiumRow({
        tier: 'premium',
        subscriptionExpiresAt: new Date('2026-06-01T00:00:00Z').toISOString(),
      }),
    ).toBe(true)
  })

  it('returns false for premium with past expiry', () => {
    expect(
      isPremiumRow({
        tier: 'premium',
        subscription_expires_at: new Date('2026-01-01T00:00:00Z').toISOString(),
      }),
    ).toBe(false)
  })

  it('treats an unparseable date as lifetime (true)', () => {
    expect(isPremiumRow({ tier: 'premium', subscription_expires_at: 'not-a-date' })).toBe(true)
  })
})

describe('isPremiumSql', () => {
  it('returns a SQL CASE expression', () => {
    const sql = isPremiumSql('u')
    expect(sql).toContain('CASE WHEN u.tier = ')
    expect(sql).toContain("'premium'")
    expect(sql).toContain('u.subscription_expires_at')
    expect(sql).toContain('NOW()')
  })

  it("defaults to 'u' alias", () => {
    expect(isPremiumSql()).toContain('u.tier')
  })

  it('respects custom alias', () => {
    expect(isPremiumSql('user_row')).toContain('user_row.tier')
  })
})

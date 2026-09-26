import { describe, it, expect, beforeEach } from 'vitest'
import { isAdFree, isPremiumUser, rememberPremium, forgetPremium } from '../../../src/utils/adEligibility'

const free = { id: 1, tier: 'free' }
const premium = { id: 2, tier: 'premium' }

describe('isAdFree', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('follows the tier when the user is known', () => {
    expect(isAdFree(premium)).toBe(true)
    expect(isAdFree(free)).toBe(false)
    expect(isAdFree({ tier: 'premium', subscription_expires_at: '2000-01-01' })).toBe(false)
    expect(isPremiumUser(null)).toBe(false)
  })

  it('a signed-out visitor with no history gets ads', () => {
    expect(isAdFree(null)).toBe(false)
  })

  it('a stored token with an unknown user (auth check failed) is ad-free', () => {
    localStorage.setItem('roam_auth_token', 'jwt')
    expect(isAdFree(null)).toBe(true)
    localStorage.clear()
    sessionStorage.setItem('roam_auth_token_session', 'jwt')
    expect(isAdFree(null)).toBe(true)
  })

  it('remembers the last known premium tier until an explicit sign out', () => {
    rememberPremium(premium)
    expect(isAdFree(null)).toBe(true)
    rememberPremium(free)
    expect(isAdFree(null)).toBe(false)
    rememberPremium(premium)
    forgetPremium()
    expect(isAdFree(null)).toBe(false)
  })
})

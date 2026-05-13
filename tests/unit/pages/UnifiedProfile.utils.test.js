import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getAuthToken, loadStatsFromStorage } from '../../../src/pages/UnifiedProfile/utils.js'

describe('UnifiedProfile/utils.getAuthToken', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('returns null when nothing stored', () => {
    expect(getAuthToken()).toBe(null)
  })

  it('prefers localStorage', () => {
    localStorage.setItem('roam_auth_token', 'A')
    sessionStorage.setItem('roam_auth_token_session', 'B')
    expect(getAuthToken()).toBe('A')
  })

  it('falls back to sessionStorage', () => {
    sessionStorage.setItem('roam_auth_token_session', 'B')
    expect(getAuthToken()).toBe('B')
  })
})

describe('UnifiedProfile/utils.loadStatsFromStorage', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    // Tuesday 2026-05-12 at noon
    vi.setSystemTime(new Date('2026-05-12T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns sane defaults on empty storage', () => {
    const s = loadStatsFromStorage()
    expect(s.totalSwipes).toBe(0)
    expect(s.timesWentOut).toBe(0)
    expect(s.boredomBusts).toBe(0)
    expect(s.bestStreak).toBe(0)
    expect(s.lastActivityDate).toBe(null)
    expect(s.currentStreak).toBe(0)
    expect(s.wishlistCount).toBe(0)
    expect(s.adventuresCreated).toBe(0)
  })

  it('preserves stored fields', () => {
    localStorage.setItem('roam_stats', JSON.stringify({ timesWentOut: 7, bestStreak: 4 }))
    const s = loadStatsFromStorage()
    expect(s.timesWentOut).toBe(7)
    expect(s.bestStreak).toBe(4)
  })

  it('keeps streak alive if last streak date is today', () => {
    localStorage.setItem('roam_stats', JSON.stringify({
      currentStreak: 5,
      lastStreakDate: new Date('2026-05-12T08:00:00Z').toISOString(),
    }))
    expect(loadStatsFromStorage().currentStreak).toBe(5)
  })

  it('keeps streak alive if last streak date is yesterday', () => {
    localStorage.setItem('roam_stats', JSON.stringify({
      currentStreak: 5,
      lastStreakDate: new Date('2026-05-11T08:00:00Z').toISOString(),
    }))
    expect(loadStatsFromStorage().currentStreak).toBe(5)
  })

  it('resets streak if last streak date is older than yesterday', () => {
    localStorage.setItem('roam_stats', JSON.stringify({
      currentStreak: 5,
      lastStreakDate: new Date('2026-05-09T08:00:00Z').toISOString(),
    }))
    expect(loadStatsFromStorage().currentStreak).toBe(0)
  })

  it('reads wishlist length from roam_wishlist', () => {
    localStorage.setItem('roam_wishlist', JSON.stringify(['a', 'b', 'c']))
    expect(loadStatsFromStorage().wishlistCount).toBe(3)
  })

  it('reads adventuresCreated from roam_adventures length', () => {
    localStorage.setItem('roam_adventures', JSON.stringify([{}, {}]))
    expect(loadStatsFromStorage().adventuresCreated).toBe(2)
  })

  it('handles empty arrays gracefully', () => {
    localStorage.setItem('roam_wishlist', '[]')
    localStorage.setItem('roam_adventures', '[]')
    const s = loadStatsFromStorage()
    expect(s.wishlistCount).toBe(0)
    expect(s.adventuresCreated).toBe(0)
  })
})

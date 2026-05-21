import { describe, it, expect, beforeEach } from 'vitest'
import { computeLevel, getAuthToken } from '../../../src/pages/UnifiedProfile/utils.js'

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

describe('UnifiedProfile/utils.computeLevel', () => {
  it('returns level 1 defaults when stats are missing', () => {
    expect(computeLevel(null)).toEqual({
      level: 1,
      totalActivity: 0,
      currentLevelFloor: 0,
      nextLevelRequirement: 1,
      levelProgress: 0,
    })
  })

  it('combines server activity into the square-progression level', () => {
    const level = computeLevel({ placesVisited: 9, contributions: 6, helpfulVotes: 5 })
    expect(level.totalActivity).toBe(17)
    expect(level.level).toBe(5)
    expect(level.currentLevelFloor).toBe(16)
    expect(level.nextLevelRequirement).toBe(25)
    expect(level.levelProgress).toBeCloseTo(11.11, 2)
  })

  it('coerces missing or invalid server counters to 0', () => {
    expect(computeLevel({ placesVisited: undefined, contributions: 'nope', helpfulVotes: 3 }).totalActivity).toBe(1)
  })
})

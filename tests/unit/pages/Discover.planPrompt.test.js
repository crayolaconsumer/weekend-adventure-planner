import { describe, it, expect } from 'vitest'
import { shouldShowPlanPrompt } from '../../../src/pages/Discover/planPrompt.js'

const DAY = 86400000

describe('Discover plan prompt timing', () => {
  it('does not interrupt the first or second save', () => {
    expect(shouldShowPlanPrompt({ totalSaves: 1 })).toBe(false)
    expect(shouldShowPlanPrompt({ totalSaves: 2 })).toBe(false)
  })

  it('first appears on the 3rd save', () => {
    expect(shouldShowPlanPrompt({ totalSaves: 3 })).toBe(true)
  })

  it('shows at most once per session', () => {
    expect(shouldShowPlanPrompt({ totalSaves: 3, sessionShown: true })).toBe(false)
  })

  it('returns only after a week and 5 more saves', () => {
    const now = 100 * DAY
    const shown = { lastShownAt: now - 8 * DAY, savesAtLastShow: 3, now }
    expect(shouldShowPlanPrompt({ ...shown, totalSaves: 8 })).toBe(true)
    expect(shouldShowPlanPrompt({ ...shown, totalSaves: 7 })).toBe(false)
    expect(shouldShowPlanPrompt({ ...shown, lastShownAt: now - 2 * DAY, totalSaves: 20 })).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { BADGES, SERVER_BADGE_CONFIG } from '../../../src/pages/UnifiedProfile/badges.js'

describe('UnifiedProfile/badges', () => {
  describe('BADGES shape', () => {
    it('every entry has id/name/icon/description/requirement', () => {
      for (const b of BADGES) {
        expect(b.id, b.id).toBeTruthy()
        expect(b.name, b.id).toBeTruthy()
        expect(b.icon, b.id).toBeTruthy()
        expect(b.description, b.id).toBeTruthy()
        expect(typeof b.requirement, b.id).toBe('function')
      }
    })

    it('all badge ids are unique', () => {
      const ids = BADGES.map(b => b.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })

  describe('BADGES requirement predicates', () => {
    const empty = { timesWentOut: 0, bestStreak: 0, justGoUses: 0, boredomBusts: 0, wishlistCount: 0, adventuresCreated: 0 }

    const findById = (id) => BADGES.find(b => b.id === id)

    it('first_adventure unlocks at 1 visit', () => {
      expect(findById('first_adventure').requirement(empty)).toBe(false)
      expect(findById('first_adventure').requirement({ ...empty, timesWentOut: 1 })).toBe(true)
    })

    it('explorer_5 / _25 / _100 ladder', () => {
      expect(findById('explorer_5').requirement({ ...empty, timesWentOut: 4 })).toBe(false)
      expect(findById('explorer_5').requirement({ ...empty, timesWentOut: 5 })).toBe(true)
      expect(findById('explorer_25').requirement({ ...empty, timesWentOut: 25 })).toBe(true)
      expect(findById('explorer_100').requirement({ ...empty, timesWentOut: 100 })).toBe(true)
    })

    it('streak_3 / _7 / _30 ladder', () => {
      expect(findById('streak_3').requirement({ ...empty, bestStreak: 3 })).toBe(true)
      expect(findById('streak_7').requirement({ ...empty, bestStreak: 6 })).toBe(false)
      expect(findById('streak_30').requirement({ ...empty, bestStreak: 30 })).toBe(true)
    })

    it('just_go counts justGoUses + boredomBusts combined', () => {
      const req = findById('just_go').requirement
      expect(req({ ...empty, justGoUses: 5, boredomBusts: 5 })).toBe(true)
      expect(req({ ...empty, justGoUses: 0, boredomBusts: 10 })).toBe(true)
      expect(req({ ...empty, justGoUses: 9, boredomBusts: 0 })).toBe(false)
    })

    it('curator unlocks at wishlistCount >= 20', () => {
      expect(findById('curator').requirement({ ...empty, wishlistCount: 19 })).toBe(false)
      expect(findById('curator').requirement({ ...empty, wishlistCount: 20 })).toBe(true)
    })

    it('planner unlocks at adventuresCreated >= 5', () => {
      expect(findById('planner').requirement({ ...empty, adventuresCreated: 5 })).toBe(true)
    })
  })

  describe('SERVER_BADGE_CONFIG', () => {
    it('has the expected server badge keys', () => {
      const expected = [
        'first_contribution', 'contributor_10', 'contributor_50',
        'first_visit', 'visits_10', 'visits_50', 'visits_100',
        'followers_10', 'followers_100',
      ]
      for (const k of expected) expect(SERVER_BADGE_CONFIG).toHaveProperty(k)
    })

    it('every config has icon + name + description', () => {
      for (const [k, c] of Object.entries(SERVER_BADGE_CONFIG)) {
        expect(c.icon, k).toBeTruthy()
        expect(c.name, k).toBeTruthy()
        expect(c.description, k).toBeTruthy()
      }
    })
  })
})

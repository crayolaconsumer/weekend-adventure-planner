import { describe, it, expect } from 'vitest'
import { ALL_BADGE_IDS, SERVER_BADGE_CONFIG } from '../../../src/pages/UnifiedProfile/badges.js'

describe('UnifiedProfile/badges', () => {
  describe('SERVER_BADGE_CONFIG', () => {
    it('has the expected server badge keys', () => {
      const expected = [
        'first_contribution', 'contributor_10', 'contributor_50',
        'first_visit', 'visits_10', 'visits_50', 'visits_100',
        'followers_10', 'followers_100',
      ]
      for (const k of expected) expect(SERVER_BADGE_CONFIG).toHaveProperty(k)
    })

    it('every config has name + description', () => {
      for (const [k, c] of Object.entries(SERVER_BADGE_CONFIG)) {
        expect(c.name, k).toBeTruthy()
        expect(c.description, k).toBeTruthy()
      }
    })
  })

  describe('ALL_BADGE_IDS', () => {
    it('contains unique ids and every id has display metadata', () => {
      expect(new Set(ALL_BADGE_IDS).size).toBe(ALL_BADGE_IDS.length)
      for (const id of ALL_BADGE_IDS) {
        expect(SERVER_BADGE_CONFIG, id).toHaveProperty(id)
      }
    })
  })
})

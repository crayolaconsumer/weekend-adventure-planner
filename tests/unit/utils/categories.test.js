import { describe, it, expect } from 'vitest'
import {
  GOOD_CATEGORIES,
  BLACKLIST,
  getCategoryForType,
  isBlacklisted,
  hasBoringName,
  getTypesForCategory,
  getAllGoodTypes,
} from '../../../src/utils/categories.js'

describe('categories', () => {
  describe('GOOD_CATEGORIES shape', () => {
    it('every category has label, icon, color, types[]', () => {
      for (const [key, cat] of Object.entries(GOOD_CATEGORIES)) {
        expect(cat.label, `${key}.label`).toBeTruthy()
        expect(cat.icon, `${key}.icon`).toBeTruthy()
        expect(cat.color, `${key}.color`).toMatch(/^#[0-9a-f]{6}$/i)
        expect(Array.isArray(cat.types), `${key}.types`).toBe(true)
        expect(cat.types.length, `${key}.types not empty`).toBeGreaterThan(0)
      }
    })

    it('contains all expected category keys', () => {
      const expected = ['food', 'nature', 'culture', 'historic', 'entertainment', 'nightlife', 'active', 'unique', 'shopping']
      for (const k of expected) expect(GOOD_CATEGORIES).toHaveProperty(k)
    })
  })

  describe('getCategoryForType', () => {
    it('returns food category for a restaurant', () => {
      const cat = getCategoryForType('restaurant')
      expect(cat?.key).toBe('food')
    })

    it('returns nature for a park', () => {
      expect(getCategoryForType('park')?.key).toBe('nature')
    })

    it('returns historic for a castle', () => {
      expect(getCategoryForType('castle')?.key).toBe('historic')
    })

    it('returns null for unknown type', () => {
      expect(getCategoryForType('totally_made_up')).toBe(null)
    })

    it('returns null for undefined / null', () => {
      expect(getCategoryForType(undefined)).toBe(null)
      expect(getCategoryForType(null)).toBe(null)
    })
  })

  describe('isBlacklisted', () => {
    it('blacklists hospital', () => {
      expect(isBlacklisted('hospital')).toBe(true)
    })

    it('blacklists pharmacy', () => {
      expect(isBlacklisted('pharmacy')).toBe(true)
    })

    it('blacklists parking variants (substring match)', () => {
      expect(isBlacklisted('parking')).toBe(true)
      expect(isBlacklisted('underground_parking')).toBe(true)
    })

    it('does not blacklist restaurants', () => {
      expect(isBlacklisted('restaurant')).toBe(false)
    })

    it('does not blacklist parks (different word)', () => {
      expect(isBlacklisted('park')).toBe(false)
    })
  })

  describe('hasBoringName', () => {
    it('flags health centre', () => {
      expect(hasBoringName('Riverside Health Centre')).toBe(true)
    })

    it('flags Tesco', () => {
      expect(hasBoringName('Tesco Express')).toBe(true)
    })

    it('flags dental surgery', () => {
      expect(hasBoringName('Smile Dental Surgery')).toBe(true)
    })

    it('does not flag interesting names', () => {
      expect(hasBoringName('The Old Bakery')).toBe(false)
      expect(hasBoringName('Hampton Court Palace')).toBe(false)
    })

    it('handles null/empty', () => {
      expect(hasBoringName(null)).toBe(false)
      expect(hasBoringName('')).toBe(false)
    })
  })

  describe('getTypesForCategory / getAllGoodTypes', () => {
    it('returns types array for valid key', () => {
      const food = getTypesForCategory('food')
      expect(food).toContain('restaurant')
      expect(food).toContain('cafe')
    })

    it('returns empty for unknown key', () => {
      expect(getTypesForCategory('nonexistent')).toEqual([])
    })

    it('getAllGoodTypes is union of all categories', () => {
      const all = getAllGoodTypes()
      expect(all).toContain('restaurant')
      expect(all).toContain('castle')
      expect(all).toContain('park')
      // Should be a non-trivial size
      expect(all.length).toBeGreaterThan(50)
    })
  })

  describe('BLACKLIST sanity', () => {
    it('is a non-empty string array', () => {
      expect(Array.isArray(BLACKLIST)).toBe(true)
      expect(BLACKLIST.length).toBeGreaterThan(0)
      for (const item of BLACKLIST) expect(typeof item).toBe('string')
    })
  })
})

// Regression (26 Oct 2026): every tourism=attraction is in 'unique', so the Empire State
// Building and Grand Central showed "Hidden Gems" on their cards
describe('getPlaceCategory', () => {
  it('labels a notable attraction a Landmark, keeping the unique key for filters', async () => {
    const { getPlaceCategory } = await import('../../../src/utils/categories')
    const esb = getPlaceCategory({ type: 'attraction', wikipedia: 'en:Empire State Building' })
    expect(esb.key).toBe('unique')
    expect(esb.label).toBe('Landmark')
    expect(esb.icon).toBe('🏛️') // not the Hidden Gems diamond
    expect(getPlaceCategory({ type: 'attraction', heritage: '2' }).label).toBe('Landmark')
  })
  it('a little-known attraction is still a Hidden Gem, and other categories are untouched', async () => {
    const { getPlaceCategory, getCategoryForType } = await import('../../../src/utils/categories')
    expect(getPlaceCategory({ type: 'windmill' }).label).toBe('Hidden Gems')
    expect(getPlaceCategory({ type: 'museum', wikipedia: 'en:Louvre' })).toEqual(getCategoryForType('museum'))
    expect(getPlaceCategory({ type: null })).toBeNull()
    // the shared category table is not mutated
    expect(getCategoryForType('attraction').label).toBe('Hidden Gems')
  })
  it('the deck path (enhancePlace) uses it', async () => {
    const { enhancePlace } = await import('../../../src/utils/placeFilter')
    expect(enhancePlace({ id: 1, type: 'attraction', wikipedia: 'en:Grand Central Terminal', lat: 40.75, lng: -73.97 }, null).category.label).toBe('Landmark')
  })
})

describe('justGo reasons name the interest, not the place label', () => {
  it('a Landmark pick still matches an interest in Hidden Gems', async () => {
    const { getPlaceCategory } = await import('../../../src/utils/categories')
    const mod = await import('../../../src/utils/justGoReasons')
    const fn = mod.justGoReasons || mod.default || Object.values(mod).find(v => typeof v === 'function')
    const place = { id: 1, name: 'York Guildhall', type: 'attraction', wikipedia: 'en:Guildhall, York' }
    place.category = getPlaceCategory(place)
    const reasons = fn(place, { interests: ['unique'] })
    const match = (Array.isArray(reasons) ? reasons : []).find(r => r.kind === 'match')
    expect(match?.text).toBe('Matches your interest in hidden gems')
  })
})

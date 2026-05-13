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

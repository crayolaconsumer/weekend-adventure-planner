import { describe, it, expect } from 'vitest'
import {
  TYPE_TO_KEYS,
  getKeysForType,
  groupTypesByKey,
  countQueryClauses,
} from '../../../src/utils/osmTagMapping.js'

describe('osmTagMapping', () => {
  describe('TYPE_TO_KEYS', () => {
    it('maps food types to amenity', () => {
      expect(TYPE_TO_KEYS.restaurant).toEqual(['amenity'])
      expect(TYPE_TO_KEYS.cafe).toEqual(['amenity'])
      expect(TYPE_TO_KEYS.pub).toEqual(['amenity'])
    })

    it('maps historic types to historic', () => {
      expect(TYPE_TO_KEYS.castle).toEqual(['historic'])
      expect(TYPE_TO_KEYS.monument).toEqual(['historic'])
    })

    it('maps nature types to leisure / natural', () => {
      expect(TYPE_TO_KEYS.park).toContain('leisure')
      expect(TYPE_TO_KEYS.beach).toContain('natural')
    })

    it('handles types that span multiple keys', () => {
      expect(TYPE_TO_KEYS.ice_cream).toContain('amenity')
      expect(TYPE_TO_KEYS.ice_cream).toContain('shop')
    })
  })

  describe('getKeysForType', () => {
    it('returns mapped keys', () => {
      expect(getKeysForType('restaurant')).toEqual(['amenity'])
    })

    it('falls back to amenity/tourism for unknown types', () => {
      expect(getKeysForType('totally_made_up')).toEqual(['amenity', 'tourism'])
    })
  })

  describe('groupTypesByKey', () => {
    it('inverts the type→keys mapping into key→types', () => {
      const grouped = groupTypesByKey(['restaurant', 'cafe', 'park'])
      expect(grouped.amenity).toEqual(expect.arrayContaining(['restaurant', 'cafe']))
      expect(grouped.leisure).toEqual(['park'])
    })

    it('places a type under every key it maps to', () => {
      const grouped = groupTypesByKey(['ice_cream'])
      expect(grouped.amenity).toEqual(['ice_cream'])
      expect(grouped.shop).toEqual(['ice_cream'])
    })

    it('handles empty input', () => {
      expect(groupTypesByKey([])).toEqual({})
    })

    it('deduplicates: same type listed twice ends up once', () => {
      const grouped = groupTypesByKey(['cafe', 'cafe'])
      expect(grouped.amenity).toEqual(['cafe'])
    })
  })

  describe('countQueryClauses', () => {
    it('returns 1 nw clause per unique key', () => {
      // restaurant + cafe both use amenity -> 1 nw clause.
      expect(countQueryClauses(['restaurant', 'cafe'])).toBe(1)
      // restaurant (amenity) + park (leisure) -> 2 nw clauses.
      expect(countQueryClauses(['restaurant', 'park'])).toBe(2)
    })

    it('returns 0 for empty input', () => {
      expect(countQueryClauses([])).toBe(0)
    })
  })
})

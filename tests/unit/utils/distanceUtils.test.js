import { describe, it, expect } from 'vitest'
import {
  formatDistance,
  getUnitLabel,
  convertToDisplayUnit,
  convertToKm,
} from '../../../src/utils/distanceUtils.js'

describe('distanceUtils', () => {
  describe('formatDistance — km mode', () => {
    it('shows meters when below 1km', () => {
      expect(formatDistance(0.5)).toBe('500m')
      expect(formatDistance(0.05)).toBe('50m')
    })

    it('shows 1 decimal for 1–10km', () => {
      expect(formatDistance(2.3)).toBe('2.3km')
      expect(formatDistance(9.5)).toBe('9.5km')
    })

    it('rounds to whole km at 10+', () => {
      expect(formatDistance(12.7)).toBe('13km')
      expect(formatDistance(100)).toBe('100km')
    })

    it('appends suffix when requested', () => {
      expect(formatDistance(2.3, 'km', { withSuffix: true })).toBe('2.3km away')
    })

    it('uses long unit name when short=false', () => {
      expect(formatDistance(2.3, 'km', { short: false })).toBe('2.3 kilometers')
      expect(formatDistance(0.5, 'km', { short: false })).toBe('500 meters')
    })
  })

  describe('formatDistance — mi mode', () => {
    it('shows feet when below 0.1 miles', () => {
      expect(formatDistance(0.05, 'mi')).toBe('164ft')
    })

    it('shows 1 decimal for 0.1–10 miles', () => {
      const result = formatDistance(2, 'mi')
      expect(result).toMatch(/^1\.2mi$/)
    })

    it('rounds to whole miles at 10+', () => {
      expect(formatDistance(20, 'mi')).toBe('12mi')
    })
  })

  describe('formatDistance — invalid input', () => {
    it('returns null for null/undefined/NaN', () => {
      expect(formatDistance(null)).toBe(null)
      expect(formatDistance(undefined)).toBe(null)
      expect(formatDistance(NaN)).toBe(null)
    })
  })

  describe('getUnitLabel', () => {
    it('returns abbreviated by default', () => {
      expect(getUnitLabel('km')).toBe('km')
      expect(getUnitLabel('mi')).toBe('mi')
    })

    it('returns full name when short=false', () => {
      expect(getUnitLabel('km', false)).toBe('kilometers')
      expect(getUnitLabel('mi', false)).toBe('miles')
    })
  })

  describe('convertToDisplayUnit', () => {
    it('returns km unchanged when unit is km', () => {
      expect(convertToDisplayUnit(5, 'km')).toBe(5)
    })

    it('converts km to miles when unit is mi', () => {
      expect(convertToDisplayUnit(10, 'mi')).toBeCloseTo(6.21371, 4)
    })

    it('returns 0 for invalid input', () => {
      expect(convertToDisplayUnit(null, 'km')).toBe(0)
      expect(convertToDisplayUnit(NaN, 'mi')).toBe(0)
    })
  })

  describe('convertToKm', () => {
    it('returns value unchanged when unit is km', () => {
      expect(convertToKm(5, 'km')).toBe(5)
    })

    it('converts miles to km when unit is mi', () => {
      expect(convertToKm(10, 'mi')).toBeCloseTo(16.0934, 3)
    })

    it('is approximately inverse of convertToDisplayUnit', () => {
      const original = 7.5
      const displayed = convertToDisplayUnit(original, 'mi')
      const back = convertToKm(displayed, 'mi')
      expect(back).toBeCloseTo(original, 5)
    })

    it('returns 0 for invalid input', () => {
      expect(convertToKm(null, 'km')).toBe(0)
      expect(convertToKm(NaN, 'mi')).toBe(0)
    })
  })
})

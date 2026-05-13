import { describe, it, expect } from 'vitest'
import { TRAVEL_MODES, DEFAULT_LOCATION, LOCATION_TIMEOUT_MS } from '../../../src/pages/Discover/constants.js'

describe('Discover/constants', () => {
  describe('TRAVEL_MODES', () => {
    it('exposes both free and premium tiers', () => {
      const free = Object.entries(TRAVEL_MODES).filter(([, m]) => !m.premium).map(([k]) => k)
      const premium = Object.entries(TRAVEL_MODES).filter(([, m]) => m.premium).map(([k]) => k)
      expect(free).toEqual(expect.arrayContaining(['walking', 'driving', 'transit']))
      expect(premium).toEqual(expect.arrayContaining(['dayTrip', 'explorer']))
    })

    it('every mode has label / icon / maxRadius / speed', () => {
      for (const [key, mode] of Object.entries(TRAVEL_MODES)) {
        expect(mode.label, key).toBeTruthy()
        expect(mode.icon, key).toBeTruthy()
        expect(typeof mode.maxRadius, key).toBe('number')
        expect(typeof mode.speed, key).toBe('number')
      }
    })

    it('maxRadius increases with travel mode breadth', () => {
      expect(TRAVEL_MODES.walking.maxRadius).toBeLessThan(TRAVEL_MODES.driving.maxRadius)
      expect(TRAVEL_MODES.driving.maxRadius).toBeLessThan(TRAVEL_MODES.dayTrip.maxRadius)
      expect(TRAVEL_MODES.dayTrip.maxRadius).toBeLessThan(TRAVEL_MODES.explorer.maxRadius)
    })
  })

  describe('DEFAULT_LOCATION', () => {
    it('points at London', () => {
      expect(DEFAULT_LOCATION.lat).toBeCloseTo(51.5074, 3)
      expect(DEFAULT_LOCATION.lng).toBeCloseTo(-0.1278, 3)
    })
  })

  describe('LOCATION_TIMEOUT_MS', () => {
    it('is a positive number under a minute', () => {
      expect(LOCATION_TIMEOUT_MS).toBeGreaterThan(0)
      expect(LOCATION_TIMEOUT_MS).toBeLessThanOrEqual(60_000)
    })
  })
})

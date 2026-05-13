import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  parseOpeningHours,
  getOpeningState,
  isPlaceOpen,
  getWeeklySchedule,
} from '../../../src/utils/openingHours.js'

const LONDON = { lat: 51.5074, lng: -0.1278 }

describe('openingHours', () => {
  describe('parseOpeningHours', () => {
    it('returns null for empty/non-string input', () => {
      expect(parseOpeningHours(null)).toBe(null)
      expect(parseOpeningHours(undefined)).toBe(null)
      expect(parseOpeningHours('')).toBe(null)
      expect(parseOpeningHours(42)).toBe(null)
    })

    it('parses a well-formed string', () => {
      const oh = parseOpeningHours('Mo-Fr 09:00-17:00', LONDON)
      expect(oh).not.toBe(null)
    })

    it('returns null for malformed strings (silent failure)', () => {
      expect(parseOpeningHours('garbage 99:99', LONDON)).toBe(null)
    })

    it('strips SH (school holiday) rules to avoid parse errors', () => {
      const oh = parseOpeningHours('Mo-Fr 09:00-17:00; SH 11:00-16:00', LONDON)
      expect(oh).not.toBe(null)
    })
  })

  describe('getOpeningState — special cases', () => {
    it("returns 'unknown' when no hours string", () => {
      const s = getOpeningState(null, LONDON)
      expect(s.state).toBe('unknown')
      expect(s.stateLabel).toBe('Hours unknown')
    })

    it("returns 'open' immediately for '24/7'", () => {
      const s = getOpeningState('24/7', LONDON)
      expect(s.state).toBe('open')
      expect(s.stateLabel).toBe('Open 24/7')
    })

    it("returns 'open' for '24 hours'", () => {
      const s = getOpeningState('24 hours', LONDON)
      expect(s.state).toBe('open')
    })

    it("returns 'unknown' for unparseable hours", () => {
      const s = getOpeningState('not real hours', LONDON)
      expect(s.state).toBe('unknown')
    })
  })

  describe('getOpeningState — open during business hours', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it("reports 'open' when within Mo-Fr 09:00-17:00 on Tuesday 14:00", () => {
      // Pick a Tuesday at 2pm local time
      vi.setSystemTime(new Date('2026-05-12T14:00:00'))
      const s = getOpeningState('Mo-Fr 09:00-17:00', LONDON)
      expect(['open', 'closing_soon']).toContain(s.state)
    })

    it("reports 'closed' when outside Mo-Fr 09:00-17:00 on Tuesday 22:00", () => {
      vi.setSystemTime(new Date('2026-05-12T22:00:00'))
      const s = getOpeningState('Mo-Fr 09:00-17:00', LONDON)
      expect(['closed', 'opening_soon']).toContain(s.state)
    })
  })

  describe('isPlaceOpen', () => {
    it('returns null when hours unknown', () => {
      expect(isPlaceOpen({})).toBe(null)
    })

    it('returns true for 24/7', () => {
      expect(isPlaceOpen({ openingHours: '24/7' })).toBe(true)
    })

    it('accepts snake_case opening_hours', () => {
      expect(isPlaceOpen({ opening_hours: '24/7' })).toBe(true)
    })
  })

  describe('getWeeklySchedule', () => {
    it('returns 7-day schedule for valid hours', () => {
      const schedule = getWeeklySchedule('Mo-Fr 09:00-17:00', LONDON)
      expect(schedule).not.toBe(null)
      expect(schedule.length).toBe(7)
      const days = schedule.map((s) => s.day)
      expect(days).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
    })

    it('returns null for invalid hours', () => {
      expect(getWeeklySchedule('not real', LONDON)).toBe(null)
    })

    it("marks weekend as 'Closed' for Mo-Fr hours", () => {
      const schedule = getWeeklySchedule('Mo-Fr 09:00-17:00', LONDON)
      const sat = schedule.find((s) => s.day === 'Saturday')
      const sun = schedule.find((s) => s.day === 'Sunday')
      expect(sat.hours).toBe('Closed')
      expect(sun.hours).toBe('Closed')
    })
  })
})

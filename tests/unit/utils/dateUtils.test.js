import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  formatDistanceToNow,
  formatDate,
  formatDateTime,
  isToday,
  startOfDay,
} from '../../../src/utils/dateUtils.js'

describe('dateUtils', () => {
  describe('formatDistanceToNow', () => {
    const FIXED_NOW = new Date('2026-05-13T12:00:00Z')

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(FIXED_NOW)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it("returns 'just now' for <60s", () => {
      const d = new Date(FIXED_NOW.getTime() - 30 * 1000)
      expect(formatDistanceToNow(d)).toBe('just now')
    })

    it('returns minutes for 1–59m', () => {
      const d = new Date(FIXED_NOW.getTime() - 5 * 60 * 1000)
      expect(formatDistanceToNow(d)).toBe('5m ago')
    })

    it('returns hours for 1–23h', () => {
      const d = new Date(FIXED_NOW.getTime() - 3 * 60 * 60 * 1000)
      expect(formatDistanceToNow(d)).toBe('3h ago')
    })

    it('returns days for 1–6d', () => {
      const d = new Date(FIXED_NOW.getTime() - 4 * 24 * 60 * 60 * 1000)
      expect(formatDistanceToNow(d)).toBe('4d ago')
    })

    it('returns weeks for 7–27d', () => {
      const d = new Date(FIXED_NOW.getTime() - 14 * 24 * 60 * 60 * 1000)
      expect(formatDistanceToNow(d)).toBe('2w ago')
    })

    it('returns months for 30–364d', () => {
      const d = new Date(FIXED_NOW.getTime() - 90 * 24 * 60 * 60 * 1000)
      expect(formatDistanceToNow(d)).toBe('3mo ago')
    })

    it('returns years for >365d', () => {
      const d = new Date(FIXED_NOW.getTime() - 400 * 24 * 60 * 60 * 1000)
      expect(formatDistanceToNow(d)).toBe('1y ago')
    })
  })

  describe('formatDate', () => {
    it('formats a date in en-GB by default', () => {
      const d = new Date('2026-05-13T12:00:00Z')
      const result = formatDate(d)
      expect(result).toContain('May')
      expect(result).toContain('2026')
    })

    it('respects custom Intl options', () => {
      const d = new Date('2026-05-13T12:00:00Z')
      const result = formatDate(d, { weekday: 'long' })
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('formatDateTime', () => {
    it('includes time fields', () => {
      const d = new Date('2026-05-13T14:30:00')
      const result = formatDateTime(d)
      expect(result).toMatch(/\d{1,2}:\d{2}/)
    })
  })

  describe('isToday', () => {
    it('is true for now', () => {
      expect(isToday(new Date())).toBe(true)
    })

    it('is false for yesterday', () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      expect(isToday(yesterday)).toBe(false)
    })

    it('is false for tomorrow', () => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      expect(isToday(tomorrow)).toBe(false)
    })
  })

  describe('startOfDay', () => {
    it('zeroes hours/minutes/seconds/ms', () => {
      const d = new Date('2026-05-13T14:30:45.123')
      const result = startOfDay(d)
      expect(result.getHours()).toBe(0)
      expect(result.getMinutes()).toBe(0)
      expect(result.getSeconds()).toBe(0)
      expect(result.getMilliseconds()).toBe(0)
    })

    it('does not mutate the input', () => {
      const d = new Date('2026-05-13T14:30:45')
      const before = d.getTime()
      startOfDay(d)
      expect(d.getTime()).toBe(before)
    })
  })
})

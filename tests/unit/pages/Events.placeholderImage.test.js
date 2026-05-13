import { describe, it, expect } from 'vitest'
import { getEventPlaceholderImage, EVENT_IMAGES } from '../../../src/pages/Events/placeholderImage.js'

describe('Events/placeholderImage', () => {
  describe('getEventPlaceholderImage', () => {
    it('uses the music bucket for music category', () => {
      const url = getEventPlaceholderImage('e1', ['music'])
      expect(EVENT_IMAGES.music).toContain(url)
    })

    it('uses the culture bucket for culture category', () => {
      expect(EVENT_IMAGES.culture).toContain(getEventPlaceholderImage('x', ['culture']))
    })

    it('falls back to default bucket for unknown category', () => {
      expect(EVENT_IMAGES.default).toContain(getEventPlaceholderImage('x', ['totally_made_up']))
    })

    it('falls back to default bucket when categories empty / undefined', () => {
      expect(EVENT_IMAGES.default).toContain(getEventPlaceholderImage('x', []))
      expect(EVENT_IMAGES.default).toContain(getEventPlaceholderImage('x', null))
      expect(EVENT_IMAGES.default).toContain(getEventPlaceholderImage('x', undefined))
    })

    it('is deterministic — same id + category returns same url every call', () => {
      const a = getEventPlaceholderImage('event-42', ['music'])
      const b = getEventPlaceholderImage('event-42', ['music'])
      expect(a).toBe(b)
    })

    it('handles missing eventId gracefully', () => {
      expect(EVENT_IMAGES.music).toContain(getEventPlaceholderImage(null, ['music']))
      expect(EVENT_IMAGES.music).toContain(getEventPlaceholderImage(undefined, ['music']))
    })

    it('handles numeric eventId', () => {
      const url = getEventPlaceholderImage(12345, ['music'])
      expect(EVENT_IMAGES.music).toContain(url)
    })
  })

  describe('EVENT_IMAGES catalog', () => {
    it('has at least 1 url per bucket', () => {
      for (const [bucket, urls] of Object.entries(EVENT_IMAGES)) {
        expect(urls.length, bucket).toBeGreaterThan(0)
      }
    })

    it('all urls are https unsplash links', () => {
      for (const urls of Object.values(EVENT_IMAGES)) {
        for (const url of urls) {
          expect(url).toMatch(/^https:\/\/images\.unsplash\.com\//)
        }
      }
    })
  })
})

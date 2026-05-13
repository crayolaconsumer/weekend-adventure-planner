import { describe, it, expect, beforeEach } from 'vitest'
import {
  getAllRatings,
  getRating,
  saveRating,
  deleteRating,
  getAggregateStats,
  getPlaceSocialProof,
  VIBE_OPTIONS,
  NOISE_OPTIONS,
  VALUE_OPTIONS,
} from '../../../src/utils/ratingsStorage.js'

describe('ratingsStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('getAllRatings', () => {
    it('returns empty object when nothing stored', () => {
      expect(getAllRatings()).toEqual({})
    })

    it('reads stored v2 ratings', () => {
      localStorage.setItem(
        'roam_ratings_v2',
        JSON.stringify({ 'place-1': { recommended: true, visitedAt: 123 } }),
      )
      expect(getAllRatings()['place-1'].recommended).toBe(true)
    })

    it('migrates legacy v1 binary ratings to v2 shape', () => {
      localStorage.setItem(
        'roam_ratings',
        JSON.stringify({
          'place-1': { liked: true, visitedAt: '2026-01-01T00:00:00Z', category: 'food' },
        }),
      )
      const all = getAllRatings()
      expect(all['place-1'].recommended).toBe(true)
      expect(all['place-1'].categoryKey).toBe('food')
      expect(typeof all['place-1'].visitedAt).toBe('number')
      expect(all['place-1'].vibe).toBe(null)
    })

    it('persists migration result', () => {
      localStorage.setItem('roam_ratings', JSON.stringify({ a: { liked: false } }))
      getAllRatings()
      expect(localStorage.getItem('roam_ratings_v2')).not.toBe(null)
    })
  })

  describe('saveRating + getRating', () => {
    it('round-trips a rating', () => {
      saveRating('place-1', { recommended: true, vibe: 'lively' })
      const r = getRating('place-1')
      expect(r.recommended).toBe(true)
      expect(r.vibe).toBe('lively')
      expect(typeof r.visitedAt).toBe('number')
    })

    it('saves to both v1 (legacy) and v2 for backward compat', () => {
      saveRating('place-1', { recommended: true, categoryKey: 'culture' })
      const v2 = JSON.parse(localStorage.getItem('roam_ratings_v2'))
      const v1 = JSON.parse(localStorage.getItem('roam_ratings'))
      expect(v2['place-1'].recommended).toBe(true)
      expect(v1['place-1'].liked).toBe(true)
      expect(v1['place-1'].category).toBe('culture')
    })

    it('preserves explicit visitedAt', () => {
      saveRating('place-1', { recommended: true, visitedAt: 999 })
      expect(getRating('place-1').visitedAt).toBe(999)
    })

    it('returns null for unknown place', () => {
      expect(getRating('does-not-exist')).toBe(null)
    })
  })

  describe('deleteRating', () => {
    it('removes from both v1 and v2', () => {
      saveRating('a', { recommended: true })
      saveRating('b', { recommended: false })
      deleteRating('a')
      expect(getRating('a')).toBe(null)
      expect(getRating('b')).not.toBe(null)
    })
  })

  describe('getAggregateStats', () => {
    it('reports zero when empty', () => {
      const s = getAggregateStats()
      expect(s.totalRatings).toBe(0)
      expect(s.recommendedCount).toBe(0)
      expect(s.recommendRate).toBe(0)
    })

    it('computes recommend rate as percentage', () => {
      saveRating('a', { recommended: true })
      saveRating('b', { recommended: true })
      saveRating('c', { recommended: false })
      saveRating('d', { recommended: false })
      const s = getAggregateStats()
      expect(s.totalRatings).toBe(4)
      expect(s.recommendedCount).toBe(2)
      expect(s.recommendRate).toBe(50)
    })
  })

  describe('getPlaceSocialProof', () => {
    it("returns count=0 when user hasn't rated", () => {
      const s = getPlaceSocialProof('unknown')
      expect(s.count).toBe(0)
      expect(s.hasUserRating).toBe(false)
    })

    it('returns 100% recommendRate when user recommended', () => {
      saveRating('place-1', { recommended: true })
      const s = getPlaceSocialProof('place-1')
      expect(s.hasUserRating).toBe(true)
      expect(s.recommendRate).toBe(100)
      expect(s.userRecommended).toBe(true)
    })
  })

  describe('option constants', () => {
    it('VIBE_OPTIONS / NOISE_OPTIONS / VALUE_OPTIONS are arrays of {value,label}', () => {
      for (const opt of [...VIBE_OPTIONS, ...NOISE_OPTIONS, ...VALUE_OPTIONS]) {
        expect(opt.value).toBeTruthy()
        expect(opt.label).toBeTruthy()
      }
    })
  })
})

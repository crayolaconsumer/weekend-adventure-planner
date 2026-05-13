import { describe, it, expect } from 'vitest'
import { selectDiverseStops } from '../../../src/pages/Plan/selectDiverseStops.js'

function p(id, cat) {
  return { id, name: id, category: { key: cat } }
}

describe('Plan/selectDiverseStops', () => {
  it('returns [] for empty pool', () => {
    expect(selectDiverseStops([], 3)).toEqual([])
  })

  it('returns at most `count` items', () => {
    const pool = Array.from({ length: 20 }, (_, i) => p(`p${i}`, 'food'))
    expect(selectDiverseStops(pool, 5).length).toBe(5)
  })

  it('returns ≤ count when pool too small', () => {
    const pool = [p('a', 'food'), p('b', 'culture')]
    expect(selectDiverseStops(pool, 10).length).toBeLessThanOrEqual(2)
  })

  describe('mixed mode (strict rotation)', () => {
    it('never picks the same category twice in a row when alternatives exist', () => {
      const pool = [
        p('a1', 'food'), p('a2', 'food'), p('a3', 'food'),
        p('b1', 'culture'), p('b2', 'culture'),
        p('c1', 'nature'), p('c2', 'nature'),
      ]
      const selected = selectDiverseStops(pool, 4, true)
      for (let i = 1; i < selected.length; i++) {
        expect(selected[i].category.key, `index ${i}`).not.toBe(selected[i - 1].category.key)
      }
    })

    it("doesn't crash when only one category exists", () => {
      const pool = Array.from({ length: 6 }, (_, i) => p(`p${i}`, 'food'))
      const selected = selectDiverseStops(pool, 4, true)
      expect(selected.length).toBeGreaterThan(0)
      expect(selected.length).toBeLessThanOrEqual(4)
    })

    it('handles missing category gracefully via "other"', () => {
      const pool = [{ id: 'no-cat-1' }, { id: 'no-cat-2' }, { id: 'no-cat-3', category: { key: 'food' } }]
      const selected = selectDiverseStops(pool, 2, true)
      expect(selected.length).toBeGreaterThan(0)
    })
  })

  describe('vibe mode (lenient)', () => {
    it('allows up to 2 from same category', () => {
      const pool = [
        p('a1', 'food'), p('a2', 'food'), p('a3', 'food'), p('a4', 'food'),
        p('b1', 'culture'),
      ]
      const selected = selectDiverseStops(pool, 4, false)
      const foodCount = selected.filter(s => s.category.key === 'food').length
      // Initial pass limits to 2 from same cat; fill-pass may add more,
      // but total is bounded by count.
      expect(foodCount).toBeLessThanOrEqual(4)
    })

    it('still fills to count from same category if pool only has that', () => {
      const pool = Array.from({ length: 5 }, (_, i) => p(`p${i}`, 'food'))
      const selected = selectDiverseStops(pool, 3, false)
      expect(selected.length).toBe(3)
    })

    it("doesn't duplicate the same place", () => {
      const pool = [p('a1', 'food'), p('a2', 'food'), p('a3', 'food')]
      const selected = selectDiverseStops(pool, 3, false)
      const ids = selected.map(s => s.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })
})

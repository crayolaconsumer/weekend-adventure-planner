import { describe, it, expect, beforeEach } from 'vitest'
import {
  scorePlace,
  filterPlaces,
  clearShownPlaces,
  isOpenNow,
  enhancePlace,
  getRandomQualityPlaces,
} from '../../../src/utils/placeFilter.js'

function makePlace(overrides = {}) {
  return {
    id: 'p1',
    name: 'The Old Bakery',
    type: 'restaurant',
    lat: 51.5,
    lng: -0.1,
    photo: null,
    website: null,
    openingHours: null,
    description: null,
    rating: null,
    source: null,
    address: null,
    ...overrides,
  }
}

describe('placeFilter.scorePlace', () => {
  it('returns 0-100 range', () => {
    const score = scorePlace(makePlace())
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('penalises blacklisted types heavily', () => {
    const good = scorePlace(makePlace({ type: 'restaurant' }))
    const bad = scorePlace(makePlace({ type: 'hospital' }))
    expect(bad).toBeLessThan(good)
    expect(bad).toBe(0) // clamped
  })

  it('penalises boring names', () => {
    const ok = scorePlace(makePlace({ name: 'The Old Bakery' }))
    const boring = scorePlace(makePlace({ name: 'Tesco Express' }))
    expect(boring).toBeLessThan(ok)
  })

  it('rewards photos', () => {
    const without = scorePlace(makePlace())
    const withPhoto = scorePlace(makePlace({ photo: 'https://example.com/x.jpg' }))
    expect(withPhoto).toBeGreaterThan(without)
  })

  it('rewards rich description', () => {
    const without = scorePlace(makePlace())
    const withDesc = scorePlace(
      makePlace({ description: 'A historic 17th-century inn in the heart of the village.' }),
    )
    expect(withDesc).toBeGreaterThan(without)
  })

  it('rewards wikipedia/wikidata presence', () => {
    const without = scorePlace(makePlace())
    const withWiki = scorePlace(makePlace({ wikipedia: 'en:Stonehenge' }))
    expect(withWiki).toBeGreaterThan(without)
  })

  it('rewards opentripmap source', () => {
    const without = scorePlace(makePlace())
    const withOtm = scorePlace(makePlace({ source: 'opentripmap', rating: 5 }))
    expect(withOtm).toBeGreaterThan(without)
  })
})

describe('placeFilter.filterPlaces', () => {
  beforeEach(() => {
    clearShownPlaces()
  })

  it('returns empty array for empty input', () => {
    expect(filterPlaces([])).toEqual([])
  })

  it('removes blacklisted types', () => {
    const places = [
      makePlace({ id: 'a', type: 'restaurant' }),
      makePlace({ id: 'b', type: 'hospital' }),
    ]
    const result = filterPlaces(places, { minScore: 0 })
    expect(result.find((p) => p.id === 'b')).toBeUndefined()
    expect(result.find((p) => p.id === 'a')).toBeDefined()
  })

  it('removes boring-named places', () => {
    const places = [
      makePlace({ id: 'a', name: 'The Crooked Wheel' }),
      makePlace({ id: 'b', name: 'Tesco Superstore' }),
    ]
    const result = filterPlaces(places, { minScore: 0 })
    expect(result.find((p) => p.id === 'a')).toBeDefined()
    expect(result.find((p) => p.id === 'b')).toBeUndefined()
  })

  it('hard-filters by selected categories', () => {
    const places = [
      makePlace({ id: 'a', type: 'restaurant' }), // food
      makePlace({ id: 'b', type: 'park' }), // nature
      makePlace({ id: 'c', type: 'museum' }), // culture
    ]
    const result = filterPlaces(places, { categories: ['food'], minScore: 0, sortBy: 'name' })
    expect(result.map((p) => p.id)).toEqual(['a'])
  })

  it('drops places below minScore', () => {
    const places = [makePlace({ id: 'a', type: 'restaurant' })]
    const result = filterPlaces(places, { minScore: 999 })
    expect(result).toEqual([])
  })

  it('respects maxResults', () => {
    const places = Array.from({ length: 30 }, (_, i) =>
      makePlace({ id: `p${i}`, name: `Place ${i}`, type: 'restaurant' }),
    )
    const result = filterPlaces(places, { maxResults: 5, minScore: 0 })
    expect(result.length).toBeLessThanOrEqual(5)
  })

  it("sortBy 'name' sorts alphabetically", () => {
    const places = [
      makePlace({ id: 'a', name: 'Zenith Bistro', type: 'restaurant' }),
      makePlace({ id: 'b', name: 'Alpha Cafe', type: 'cafe' }),
    ]
    const result = filterPlaces(places, { sortBy: 'name', minScore: 0, ensureDiversity: false })
    expect(result[0].name).toBe('Alpha Cafe')
  })
})

describe('placeFilter.isOpenNow', () => {
  it('returns null when no hours', () => {
    expect(isOpenNow({})).toBe(null)
  })

  it('returns true for 24/7', () => {
    expect(isOpenNow({ openingHours: '24/7' })).toBe(true)
  })

  it('returns true for 24 hours phrase', () => {
    expect(isOpenNow({ openingHours: 'Open 24 hours' })).toBe(true)
  })

  it('returns null for normal hours (simplified)', () => {
    expect(isOpenNow({ openingHours: 'Mo-Fr 09:00-17:00' })).toBe(null)
  })
})

describe('placeFilter.enhancePlace', () => {
  it('adds score, category, isOpen, and distance', () => {
    const enhanced = enhancePlace(
      makePlace({ type: 'restaurant', lat: 51.5, lng: -0.1 }),
      { lat: 51.6, lng: -0.1 },
    )
    expect(enhanced.score).toBeGreaterThanOrEqual(0)
    expect(enhanced.category?.key).toBe('food')
    expect(enhanced.distance).toBeGreaterThan(0)
    expect(enhanced.distance).toBeLessThan(20) // ~11km between these
  })

  it('returns null distance when no userLocation', () => {
    const enhanced = enhancePlace(makePlace(), null)
    expect(enhanced.distance).toBe(null)
  })
})

describe('placeFilter.getRandomQualityPlaces', () => {
  beforeEach(() => {
    clearShownPlaces()
  })

  it('returns no more than count', () => {
    const places = Array.from({ length: 30 }, (_, i) =>
      makePlace({ id: `p${i}`, name: `Place ${i}`, type: 'restaurant' }),
    )
    const result = getRandomQualityPlaces(places, 5)
    expect(result.length).toBeLessThanOrEqual(5)
  })

  it('handles empty list gracefully', () => {
    expect(getRandomQualityPlaces([], 5)).toEqual([])
  })
})

describe('placeFilter deck ranking (selectWithDiversity)', () => {
  const at = (id, type, distance, extra = {}) =>
    makePlace({ id, name: `Spot ${id}`, type, distance, lat: 51.5 + distance / 100, lng: -0.1, ...extra })

  it('drops access=private and access=no places, keeps the rest', () => {
    const places = [
      at('open', 'park', 1),
      at('private', 'park', 1, { access: 'private' }),
      at('no', 'park', 1, { access: 'no' }),
      at('customers', 'park', 1, { access: 'customers' }),
    ]
    const ids = filterPlaces(places, { minScore: 0 }).map(p => p.id)
    expect(ids).toContain('open')
    expect(ids).toContain('customers')
    expect(ids).not.toContain('private')
    expect(ids).not.toContain('no')
  })

  it('puts the nearer of two otherwise equal places first, whatever the seed', () => {
    for (let seed = 0; seed < 25; seed++) {
      const out = filterPlaces([at('far', 'restaurant', 4.8), at('near', 'restaurant', 0.2)], { minScore: 0, seed })
      expect(out.map(p => p.id)).toEqual(['near', 'far'])
    }
  })

  it('puts an open-now place ahead of a closed one, whatever the seed', () => {
    for (let seed = 0; seed < 25; seed++) {
      const out = filterPlaces([
        at('closed', 'restaurant', 1, { openingHours: 'Mo-Su off' }),
        at('open', 'restaurant', 1, { openingHours: '24/7' }),
      ], { minScore: 0, seed })
      expect(out.map(p => p.id)).toEqual(['open', 'closed'])
    }
  })

  it('puts a closed place behind one with unknown hours, whatever the seed', () => {
    for (let seed = 0; seed < 25; seed++) {
      const out = filterPlaces([
        at('closed', 'restaurant', 1, { openingHours: 'Mo-Su off', website: 'https://x.test' }),
        at('unknown', 'restaurant', 1, { website: 'https://x.test', phone: '1', address: '1 St' }),
      ], { minScore: 0, seed })
      expect(out.map(p => p.id)).toEqual(['unknown', 'closed'])
    }
  })

  const mixedPool = () => ['restaurant', 'park', 'museum', 'cafe', 'castle', 'pub'].flatMap((type, t) =>
    Array.from({ length: 5 }, (_, i) => at(`${type}-${i}`, type, 0.3 + ((i * 7 + t * 3) % 10) / 4)))

  it('is stable for one seed and varies across seeds', () => {
    const order = seed => filterPlaces(mixedPool(), { minScore: 0, seed }).map(p => p.id).join()
    expect(order(7)).toBe(order(7))
    const distinct = new Set(Array.from({ length: 10 }, (_, s) => order(s)))
    expect(distinct.size).toBeGreaterThan(1)
  })

  it('still mixes categories at the top of the deck', () => {
    const top = filterPlaces(mixedPool(), { minScore: 0, seed: 3 }).slice(0, 4)
    expect(new Set(top.map(p => p.category?.key)).size).toBeGreaterThanOrEqual(3)
  })
})

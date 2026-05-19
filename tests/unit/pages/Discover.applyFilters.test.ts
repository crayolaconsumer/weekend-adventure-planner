import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { applyDiscoverFilters, buildFilterKey } from '../../../src/pages/Discover/applyFilters'

function p(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'The Old Bakery',
    type: 'restaurant',
    lat: 51.5,
    lng: -0.1,
    ...overrides,
  }
}

const defaults = {
  selectedCategories: [],
  showFreeOnly: false,
  accessibilityMode: false,
  showOpenOnly: false,
  showLocalsPicks: false,
  showOffPeak: false,
  isPremium: false,
  userProfile: null,
  weather: null,
  friendActivity: null,
}

describe('Discover/applyFilters.buildFilterKey', () => {
  it('produces stable, deterministic keys', () => {
    const opts = {
      travelMode: 'walking',
      showFreeOnly: false,
      accessibilityMode: false,
      showOpenOnly: false,
      showLocalsPicks: false,
      showOffPeak: false,
      selectedCategories: ['food', 'culture'],
    }
    const a = buildFilterKey(opts)
    const b = buildFilterKey(opts)
    expect(a).toBe(b)
  })

  it("doesn't depend on selectedCategories input order", () => {
    const k1 = buildFilterKey({ travelMode: 'walking', showFreeOnly: false, accessibilityMode: false, showOpenOnly: false, showLocalsPicks: false, showOffPeak: false, selectedCategories: ['food', 'culture'] })
    const k2 = buildFilterKey({ travelMode: 'walking', showFreeOnly: false, accessibilityMode: false, showOpenOnly: false, showLocalsPicks: false, showOffPeak: false, selectedCategories: ['culture', 'food'] })
    expect(k1).toBe(k2)
  })

  it('changes when travelMode changes', () => {
    const base = { showFreeOnly: false, accessibilityMode: false, showOpenOnly: false, showLocalsPicks: false, showOffPeak: false, selectedCategories: [] }
    expect(buildFilterKey({ ...base, travelMode: 'walking' })).not.toBe(buildFilterKey({ ...base, travelMode: 'driving' }))
  })
})

describe('Discover/applyFilters.applyDiscoverFilters', () => {
  it('returns [] for null/empty input', () => {
    expect(applyDiscoverFilters([], defaults)).toEqual([])
    expect(applyDiscoverFilters(null, defaults)).toEqual([])
    expect(applyDiscoverFilters(undefined, defaults)).toEqual([])
  })

  describe('hard category filter', () => {
    it('only returns places matching selectedCategories', () => {
      const places = [
        p({ id: 'a', type: 'restaurant' }), // food
        p({ id: 'b', type: 'park', name: 'Hyde Park' }), // nature
      ]
      const out = applyDiscoverFilters(places, { ...defaults, selectedCategories: ['food'] })
      expect(out.map(x => x.id)).toEqual(['a'])
    })
  })

  describe('showFreeOnly', () => {
    it('drops places with fee="yes"', () => {
      const places = [
        p({ id: 'a', name: 'The Old Bakery', type: 'restaurant', fee: 'no' }),
        p({ id: 'b', name: 'The New Bakery', type: 'restaurant', fee: 'yes' }),
      ]
      const out = applyDiscoverFilters(places, { ...defaults, showFreeOnly: true })
      expect(out.find(x => x.id === 'b')).toBeUndefined()
    })

    it('keeps parks regardless of fee tag', () => {
      const places = [p({ id: 'p', type: 'park', name: 'Hyde Park', fee: 'yes' })]
      const out = applyDiscoverFilters(places, { ...defaults, showFreeOnly: true })
      expect(out).toHaveLength(1)
    })
  })

  describe('accessibilityMode', () => {
    it('drops places explicitly marked wheelchair=no', () => {
      const places = [
        p({ id: 'a', name: 'Accessible Cafe', type: 'cafe', wheelchair: 'yes' }),
        p({ id: 'b', name: 'Stairs Only Cafe', type: 'cafe', wheelchair: 'no' }),
      ]
      const out = applyDiscoverFilters(places, { ...defaults, accessibilityMode: true })
      expect(out.find(x => x.id === 'b')).toBeUndefined()
    })

    it("doesn't drop places without wheelchair tag (unknown = treat as accessible)", () => {
      const places = [p({ id: 'a', name: 'The Old Pub', type: 'pub' })]
      const out = applyDiscoverFilters(places, { ...defaults, accessibilityMode: true })
      expect(out).toHaveLength(1)
    })
  })

  describe("showLocalsPicks (premium)", () => {
    it('only applies when isPremium=true', () => {
      const places = [
        p({ id: 'chain', name: 'Starbucks', brand: 'Starbucks', type: 'cafe' }),
        p({ id: 'indie', name: 'The Indie Cafe', type: 'cafe' }),
      ]
      // free user — locals picks toggle has no effect
      const free = applyDiscoverFilters(places, { ...defaults, showLocalsPicks: true, isPremium: false })
      expect(free.find(x => x.id === 'chain')).toBeDefined()
    })

    it('drops chains when premium + locals picks', () => {
      const places = [
        p({ id: 'chain', name: 'Starbucks', brand: 'Starbucks', type: 'cafe' }),
        p({ id: 'indie', name: 'The Indie Cafe', type: 'cafe' }),
      ]
      const out = applyDiscoverFilters(places, { ...defaults, showLocalsPicks: true, isPremium: true })
      expect(out.find(x => x.id === 'chain')).toBeUndefined()
      expect(out.find(x => x.id === 'indie')).toBeDefined()
    })

    it('drops tourist traps when premium', () => {
      const places = [
        p({ id: 'tt', name: 'Generic Tourist Trap', type: 'amusement_park', tourism: 'attraction' }),
        p({ id: 'good', name: 'Local Spot', type: 'cafe' }),
      ]
      const out = applyDiscoverFilters(places, { ...defaults, showLocalsPicks: true, isPremium: true })
      expect(out.find(x => x.id === 'tt')).toBeUndefined()
    })

    it('matches the chain regex on common UK names', () => {
      const chains = ['Costa Coffee', 'McDonald\'s', 'Wetherspoons', 'Greggs', 'Pret a Manger', 'Subway']
      for (const name of chains) {
        const out = applyDiscoverFilters(
          [p({ id: name, name, type: 'cafe' })],
          { ...defaults, showLocalsPicks: true, isPremium: true },
        )
        expect(out, name).toHaveLength(0)
      }
    })
  })

  describe('showOffPeak (premium)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('drops restaurants during peak lunch (12-14)', () => {
      // Tuesday at 13:00
      vi.setSystemTime(new Date('2026-05-12T13:00:00'))
      const places = [p({ id: 'r', name: 'The Old Bakery', type: 'restaurant' })]
      const out = applyDiscoverFilters(places, { ...defaults, showOffPeak: true, isPremium: true })
      expect(out).toHaveLength(0)
    })

    it('keeps restaurants outside peak times', () => {
      vi.setSystemTime(new Date('2026-05-12T15:30:00'))
      const places = [p({ id: 'r', name: 'The Old Bakery', type: 'restaurant' })]
      const out = applyDiscoverFilters(places, { ...defaults, showOffPeak: true, isPremium: true })
      expect(out).toHaveLength(1)
    })

    it('drops parks during weekend daytime', () => {
      // Saturday at noon
      vi.setSystemTime(new Date('2026-05-09T12:00:00'))
      const places = [p({ id: 'p', name: 'Hyde Park', type: 'park' })]
      const out = applyDiscoverFilters(places, { ...defaults, showOffPeak: true, isPremium: true })
      expect(out).toHaveLength(0)
    })
  })

  describe('locals picks sorts by qualityScore desc', () => {
    it('higher quality first', () => {
      const places = [
        p({ id: 'lo', name: 'The Low Quality Spot', type: 'cafe', qualityScore: 35 }),
        p({ id: 'hi', name: 'The High Quality Spot', type: 'cafe', qualityScore: 90 }),
      ]
      const out = applyDiscoverFilters(places, { ...defaults, showLocalsPicks: true, isPremium: true })
      expect(out[0].id).toBe('hi')
    })
  })

  describe('distance bands', () => {
    it('applies Day Trip bands to premium-radius results', () => {
      const places = [
        p({ id: 'near', name: 'Nearby Spot', type: 'park', distance: 35 }),
        p({ id: 'outer', name: 'Outer Spot', type: 'park', distance: 64 }),
        p({ id: 'too-far', name: 'Too Far Spot', type: 'park', distance: 73 }),
      ]

      const out = applyDiscoverFilters(places, {
        ...defaults,
        travelMode: 'dayTrip',
        selectedBand: 'long',
      })

      expect(out.map(x => x.id)).toEqual(['outer'])
    })

    it('applies Explorer bands to premium-radius results', () => {
      const places = [
        p({ id: 'short', name: 'Short Explorer Spot', type: 'park', distance: 82 }),
        p({ id: 'medium', name: 'Medium Explorer Spot', type: 'park', distance: 95 }),
        p({ id: 'long', name: 'Long Explorer Spot', type: 'park', distance: 105 }),
      ]

      const out = applyDiscoverFilters(places, {
        ...defaults,
        travelMode: 'explorer',
        selectedBand: 'medium',
      })

      expect(out.map(x => x.id)).toEqual(['medium'])
    })
  })
})

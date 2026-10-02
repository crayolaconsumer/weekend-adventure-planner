import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { applyDiscoverFilters, buildFilterKey, isDogFriendly, dogCheck } from '../../../src/pages/Discover/applyFilters'

function p(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p1',
    name: 'The Old Bakery',
    type: 'restaurant',
    lat: 51.5,
    lng: -0.1,
    ...overrides,
  }
}

// A spread of types so diversity weaving can't cull a single-type fixture
const TYPE_CYCLE = ['restaurant', 'cafe', 'park', 'museum', 'pub', 'garden', 'library', 'cinema']

const defaults = {
  selectedCategories: [],
  showFreeOnly: false,
  accessibilityMode: false,

  showLocalsPicks: false,
  showOffPeak: false,
  showDogs: false,
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
     
      showLocalsPicks: false,
      showOffPeak: false,
      showDogs: false,
      selectedCategories: ['food', 'culture'],
    }
    const a = buildFilterKey(opts)
    const b = buildFilterKey(opts)
    expect(a).toBe(b)
  })

  it("doesn't depend on selectedCategories input order", () => {
    const k1 = buildFilterKey({ travelMode: 'walking', showFreeOnly: false, accessibilityMode: false, showLocalsPicks: false, showOffPeak: false, showDogs: false, selectedCategories: ['food', 'culture'] })
    const k2 = buildFilterKey({ travelMode: 'walking', showFreeOnly: false, accessibilityMode: false, showLocalsPicks: false, showOffPeak: false, showDogs: false, selectedCategories: ['culture', 'food'] })
    expect(k1).toBe(k2)
  })

  it('changes when travelMode changes', () => {
    const base = { showFreeOnly: false, accessibilityMode: false, showLocalsPicks: false, showOffPeak: false, showDogs: false, selectedCategories: [] }
    expect(buildFilterKey({ ...base, travelMode: 'walking' })).not.toBe(buildFilterKey({ ...base, travelMode: 'driving' }))
  })

  it('changes when showDogs changes', () => {
    const base = { travelMode: 'walking', showFreeOnly: false, accessibilityMode: false, showLocalsPicks: false, showOffPeak: false, selectedCategories: [] }
    expect(buildFilterKey({ ...base, showDogs: false })).not.toBe(buildFilterKey({ ...base, showDogs: true }))
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

    it('drops a ticketed park (fee="yes"), keeps an untagged one', () => {
      const places = [
        p({ id: 'paid', type: 'park', name: 'Kew Gardens', fee: 'yes' }),
        p({ id: 'free', type: 'park', name: 'Hyde Park' }),
      ]
      const out = applyDiscoverFilters(places, { ...defaults, showFreeOnly: true })
      expect(out.map(x => x.id)).toEqual(['free'])
    })
  })

  describe('accessibilityMode', () => {
    it('keeps only confirmed step-free places (wheelchair="yes")', () => {
      // The label promises accessible, so the predicate matches: "no",
      // "limited" and a missing tag are all not accessible.
      const places = [
        p({ id: 'yes', name: 'Step Free Cafe', type: 'cafe', wheelchair: 'yes', heritage: 'yes', website: 'w', description: 'A long description of a notable cafe that is well documented', openingHours: '24/7', phone: '1', address: 'a' }),
        p({ id: 'no', name: 'Stairs Only Cafe', type: 'cafe', wheelchair: 'no' }),
        p({ id: 'limited', name: 'Ramp Cafe', type: 'cafe', wheelchair: 'limited' }),
        p({ id: 'unknown', name: 'The Old Pub', type: 'pub' }),
      ]
      const out = applyDiscoverFilters(places, { ...defaults, accessibilityMode: true })
      expect(out.map(x => x.id)).toEqual(['yes'])
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

    it('keeps non-chain attractions (the scorer rewards them)', () => {
      // tourism=attraction is NOT a veto: the scorer rewards famous
      // places, so a historic castle is exactly what locals pick.
      const places = [
        p({ id: 'castle', name: 'Historic Castle', type: 'castle', tourism: 'attraction', qualityScore: 60, heritage: 'yes', website: 'w', description: 'A long description of a notable castle that is well documented', openingHours: '24/7', phone: '1', address: 'a' }),
      ]
      const out = applyDiscoverFilters(places, { ...defaults, showLocalsPicks: true, isPremium: true })
      expect(out.map(x => x.id)).toEqual(['castle'])
    })

    it('drops low-quality non-chain places (qualityScore < 30)', () => {
      const places = [
        p({ id: 'low', name: 'The Dull Diner', type: 'cafe', qualityScore: 10, heritage: 'yes', website: 'w', description: 'A long description of a notable diner that is well documented', openingHours: 'Su-Mo 09:00-18:00', phone: '1', address: 'a' }),
      ]
      const out = applyDiscoverFilters(places, { ...defaults, showLocalsPicks: true, isPremium: true })
      expect(out).toHaveLength(0)
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
      vi.setSystemTime(new Date('2026-05-12T13:00:00Z'))
      const places = [p({ id: 'r', name: 'The Old Bakery', type: 'restaurant' })]
      const out = applyDiscoverFilters(places, { ...defaults, showOffPeak: true, isPremium: true })
      expect(out).toHaveLength(0)
    })

    it('keeps restaurants outside peak times', () => {
      vi.setSystemTime(new Date('2026-05-12T15:30:00Z'))
      const places = [p({ id: 'r', name: 'The Old Bakery', type: 'restaurant' })]
      const out = applyDiscoverFilters(places, { ...defaults, showOffPeak: true, isPremium: true })
      expect(out).toHaveLength(1)
    })

    it('drops parks during weekend daytime', () => {
      // Saturday at noon
      vi.setSystemTime(new Date('2026-05-09T12:00:00Z'))
      const places = [p({ id: 'p', name: 'Hyde Park', type: 'park' })]
      const out = applyDiscoverFilters(places, { ...defaults, showOffPeak: true, isPremium: true })
      expect(out).toHaveLength(0)
    })

    it('drops fast food at lunch too (type coverage)', () => {
      vi.setSystemTime(new Date('2026-05-12T13:00:00Z'))
      const places = [p({ id: 'ff', name: 'The Chip Shop', type: 'fast_food' })]
      const out = applyDiscoverFilters(places, { ...defaults, showOffPeak: true, isPremium: true })
      expect(out).toHaveLength(0)
    })

    it('vetoes on the destination clock, not the phone clock', () => {
      // 13:00 UTC is peak lunch in London (offset 0) but 09:00 in New
      // York (UTC-4 in May): the NY diner survives.
      vi.setSystemTime(new Date('2026-05-12T13:00:00Z'))
      const places = [p({ id: 'ny', name: 'NY Diner', type: 'restaurant', lat: 40.7, lng: -74 })]
      const out = applyDiscoverFilters(places, { ...defaults, showOffPeak: true, isPremium: true })
      expect(out.map(x => x.id)).toEqual(['ny'])
    })
  })

  describe('isDogFriendly', () => {
    it('accepts the dog-friendly OSM values only', () => {
      for (const v of ['yes', 'conditional', 'leashed', 'unleashed', 'outside']) {
        expect(isDogFriendly(v), v).toBe(true)
      }
      for (const v of ['no', 'designated', undefined, null, '']) {
        expect(isDogFriendly(v), String(v)).toBe(false)
      }
    })
  })

  describe('dogCheck (type-aware)', () => {
    it('a theme or water park is not open green space', () => {
      expect(dogCheck(p({ type: 'theme_park' }))).toEqual({ pass: false, inferred: false })
      expect(dogCheck(p({ type: 'water_park' }))).toEqual({ pass: false, inferred: false })
    })

    it('dog_park always passes, never inferred', () => {
      expect(dogCheck(p({ type: 'dog_park' }))).toEqual({ pass: true, inferred: false })
      expect(dogCheck(p({ type: 'dog_park', dog: 'no' }))).toEqual({ pass: true, inferred: false })
    })

    it('open green spaces pass when the dog tag is missing (inferred)', () => {
      for (const type of ['park', 'common', 'recreation_ground', 'wood', 'heath', 'moor']) {
        expect(dogCheck(p({ type })), type).toEqual({ pass: true, inferred: true })
      }
    })

    it('open green spaces fail only on dog=no', () => {
      for (const type of ['park', 'common', 'recreation_ground', 'wood', 'heath', 'moor']) {
        expect(dogCheck(p({ type, dog: 'no' })), type).toEqual({ pass: false, inferred: false })
      }
    })

    it('open green spaces with an explicit friendly tag are confirmed (not inferred)', () => {
      for (const type of ['park', 'common', 'recreation_ground', 'wood', 'heath', 'moor']) {
        expect(dogCheck(p({ type, dog: 'yes' })), type).toEqual({ pass: true, inferred: false })
      }
    })

    it('nature reserves and beaches stay strict (explicit tag only)', () => {
      expect(dogCheck(p({ type: 'nature_reserve' }))).toEqual({ pass: false, inferred: false })
      expect(dogCheck(p({ type: 'nature_reserve', dog: 'yes' }))).toEqual({ pass: true, inferred: false })
      expect(dogCheck(p({ type: 'beach' }))).toEqual({ pass: false, inferred: false })
      expect(dogCheck(p({ type: 'beach', dog: 'leashed' }))).toEqual({ pass: true, inferred: false })
    })

    it('everything else stays strict (explicit tag only)', () => {
      expect(dogCheck(p({ type: 'cafe' }))).toEqual({ pass: false, inferred: false })
      expect(dogCheck(p({ type: 'cafe', dog: 'yes' }))).toEqual({ pass: true, inferred: false })
      expect(dogCheck(p({ type: 'cafe', dog: 'no' }))).toEqual({ pass: false, inferred: false })
    })
  })

  describe('showDogs (premium)', () => {
    it('only applies when isPremium=true', () => {
      const places = [p({ id: 'a', name: 'The Old Bakery', type: 'cafe' })]
      const free = applyDiscoverFilters(places, { ...defaults, showDogs: true, isPremium: false })
      expect(free.find(x => x.id === 'a')).toBeDefined()
    })

    it('keeps only explicitly dog-friendly places', () => {
      const places = [
        p({ id: 'yes', name: 'Dog Yes', type: 'cafe', dog: 'yes' }),
        p({ id: 'cond', name: 'Dog Conditional', type: 'cafe', dog: 'conditional' }),
        p({ id: 'leash', name: 'Dog Leashed', type: 'cafe', dog: 'leashed' }),
        p({ id: 'unleash', name: 'Dog Unleashed', type: 'cafe', dog: 'unleashed' }),
        p({ id: 'outside', name: 'Dog Outside', type: 'cafe', dog: 'outside' }),
        p({ id: 'no', name: 'Dog No', type: 'cafe', dog: 'no' }),
        p({ id: 'care', name: 'Dog Groomer', type: 'cafe', dog: 'designated' }),
        p({ id: 'unknown', name: 'Dog Unknown', type: 'cafe' }),
      ]
      const out = applyDiscoverFilters(places, { ...defaults, showDogs: true, isPremium: true })
      expect(out.map(x => x.id).sort()).toEqual(['cond', 'leash', 'outside', 'unleash', 'yes'])
    })

    it('drops dog-unknown places beyond the cap too (false scarcity)', () => {
      // Same shape as the free-only case: 50 untagged places outrank the 2
      // dog-friendly ones. Eligibility runs before the 50-result cap, so
      // the dog-friendly places are not crowded out.
      const ineligible = Array.from({ length: 50 }, (_, i) =>
        p({ id: `unknown-${i}`, name: `The Old Cafe ${i}`, type: 'restaurant', heritage: 'yes', website: 'w', description: 'A long description of a notable venue that is well documented', openingHours: 'Su-Mo 09:00-18:00', phone: '1', address: 'a' }))
      const eligible = [
        p({ id: 'yes', name: 'Dog Yes', type: 'restaurant', dog: 'yes' }),
        p({ id: 'leash', name: 'Dog Leashed', type: 'restaurant', dog: 'leashed' }),
      ]
      const out = applyDiscoverFilters([...ineligible, ...eligible], { ...defaults, showDogs: true, isPremium: true })
      expect(out.length).toBeGreaterThan(0)
      expect(out.every(x => x.dog === 'yes' || x.dog === 'leashed')).toBe(true)
      expect(out.find(x => String(x.id).startsWith('unknown-'))).toBeUndefined()
    })

    it('marks inferred open green spaces and confirmed tagged places on the place', () => {
      const places = [
        p({ id: 'park-missing', type: 'park' }),
        p({ id: 'park-yes', type: 'park', dog: 'yes' }),
        p({ id: 'dogpark', type: 'dog_park' }),
        p({ id: 'cafe-yes', type: 'cafe', dog: 'yes' }),
      ]
      const out = applyDiscoverFilters(places, { ...defaults, showDogs: true, isPremium: true })
      const byId = Object.fromEntries(out.map(x => [x.id, x]))
      for (const id of ['park-missing', 'park-yes', 'dogpark', 'cafe-yes']) {
        expect(byId[id].dogFriendly, id).toBe(true)
      }
      expect(byId['park-missing'].dogInferred).toBe(true)  // inferred
      expect(byId['park-yes'].dogInferred).toBe(false)     // confirmed
      expect(byId['dogpark'].dogInferred).toBe(false)      // confirmed
      expect(byId['cafe-yes'].dogInferred).toBe(false)     // confirmed
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

    // Parks/viewpoints are treated as free by the free-only predicate, so a
  // "paid" fixture must never use those types or it survives the filter.
  const NO_PARK_TYPES = ['restaurant', 'cafe', 'museum', 'pub', 'garden', 'library', 'cinema']

  describe('eligibility before the final 50-limit (false scarcity)', () => {
    it('keeps eligible places that sit beyond a cap of high-ranked ineligible ones', () => {
      // 50 ticketed places that all outrank the 10 free ones (same category,
      // so diversity weaving can't interleave the free ones in). With the old
      // order the 50 paid places filled the 50-result cap and the free filter
      // removed all of them, so the eligible places beyond the cap were never
      // seen. The attribute boosts (heritage/website/description/…) give the
      // paid places a deterministic score gap over the bare free ones.
      const ineligible = Array.from({ length: 50 }, (_, i) =>
        p({ id: `paid-${i}`, name: `The Old Paid ${i}`, type: 'restaurant', fee: 'yes', heritage: 'yes', website: 'w', description: 'A long description of a notable paid venue that is well documented', openingHours: 'Su-Mo 09:00-18:00', phone: '1', address: 'a' }))
      const eligible = Array.from({ length: 10 }, (_, i) =>
        p({ id: `free-${i}`, name: `The Old Free ${i}`, type: 'restaurant', fee: 'no' }))
      const out = applyDiscoverFilters([...ineligible, ...eligible], { ...defaults, showFreeOnly: true })
      expect(out.length).toBeGreaterThan(0)
      // every survivor is eligible (free); none of the paid ones made it in
      expect(out.every(x => x.fee === 'no')).toBe(true)
      expect(out.find(x => String(x.id).startsWith('paid-'))).toBeUndefined()
    })

    it('same for accessibility: accessible places beyond a cap of wheelchair=no', () => {
      // Same shape as the free-only case: 50 inaccessible places that all
      // outrank the 10 accessible ones (same category so diversity weaving
      // can't interleave the accessible ones in). The attribute boosts give
      // the inaccessible places a deterministic score gap.
      const ineligible = Array.from({ length: 50 }, (_, i) =>
        p({ id: `no-${i}`, name: `The Old Stairs ${i}`, type: 'restaurant', wheelchair: 'no', heritage: 'yes', website: 'w', description: 'A long description of a notable venue that is well documented', openingHours: 'Su-Mo 09:00-18:00', phone: '1', address: 'a' }))
      const eligible = Array.from({ length: 10 }, (_, i) =>
        p({ id: `yes-${i}`, name: `The Old Stepfree ${i}`, type: 'restaurant', wheelchair: 'yes' }))
      const out = applyDiscoverFilters([...ineligible, ...eligible], { ...defaults, accessibilityMode: true })
      expect(out.length).toBeGreaterThan(0)
      expect(out.every(x => x.wheelchair === 'yes')).toBe(true)
      expect(out.find(x => String(x.id).startsWith('no-'))).toBeUndefined()
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

  describe('sortByDistance', () => {
    it('orders the deck nearest-first when on', () => {
      const places = [
        p({ id: 'far', name: 'Far Spot', type: 'museum', distance: 9 }),
        p({ id: 'mid', name: 'Mid Spot', type: 'cafe', distance: 4 }),
        p({ id: 'near', name: 'Near Spot', type: 'park', distance: 1 }),
      ]
      const out = applyDiscoverFilters(places, { ...defaults, sortByDistance: true })
      expect(out.map(x => x.id)).toEqual(['near', 'mid', 'far'])
    })

    it('puts null distances last', () => {
      const places = [
        p({ id: 'null', name: 'No Location', type: 'museum' }),
        p({ id: 'near', name: 'Near Spot', type: 'cafe', distance: 2 }),
        p({ id: 'far', name: 'Far Spot', type: 'park', distance: 8 }),
      ]
      const out = applyDiscoverFilters(places, { ...defaults, sortByDistance: true })
      expect(out.map(x => x.id)).toEqual(['near', 'far', 'null'])
    })

    it('leaves the deck intact when off (no distance cull)', () => {
      const places = [
        p({ id: 'far', name: 'Far Spot', type: 'museum', distance: 9 }),
        p({ id: 'near', name: 'Near Spot', type: 'cafe', distance: 1 }),
      ]
      const out = applyDiscoverFilters(places, { ...defaults })
      expect(out).toHaveLength(2)
    })

    it('is a no-op when every distance is null (no user location)', () => {
      // All-null distances means the comparator must return 0 for every pair
      // (Infinity === Infinity), a stable no-op. If it ever returned NaN the
      // order would diverge from the unsorted deck — this catches that.
      const places = [
        p({ id: 'a', name: 'Spot A', type: 'museum' }),
        p({ id: 'b', name: 'Spot B', type: 'cafe' }),
        p({ id: 'c', name: 'Spot C', type: 'park' }),
      ]
      const withSort = applyDiscoverFilters(places, { ...defaults, sortByDistance: true })
      const withoutSort = applyDiscoverFilters(places, { ...defaults })
      expect(withSort.map(x => x.id)).toEqual(withoutSort.map(x => x.id))
    })

    it('puts NaN distances last (a place with no coords)', () => {
      // A place missing lat/lng yields distance = NaN from enhancePlace, not
      // null. Number.isFinite must catch it the way ?? does not.
      const places = [
        p({ id: 'nan', name: 'No Coords', type: 'museum', distance: NaN }),
        p({ id: 'near', name: 'Near Spot', type: 'cafe', distance: 2 }),
        p({ id: 'far', name: 'Far Spot', type: 'park', distance: 8 }),
      ]
      const out = applyDiscoverFilters(places, { ...defaults, sortByDistance: true })
      expect(out.map(x => x.id)).toEqual(['near', 'far', 'nan'])
    })
  })
})

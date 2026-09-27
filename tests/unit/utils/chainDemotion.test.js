import { describe, it, expect, beforeEach, vi } from 'vitest'
import { isChainPlace } from '../../../src/utils/badges.js'
import { scorePlace, filterPlaces, clearShownPlaces } from '../../../src/utils/placeFilter.js'
import { getTopRecommendations } from '../../../src/utils/tasteProfile.js'

const base = { type: 'cafe', lat: 51.5, lng: -0.1, website: 'https://x.test', openingHours: 'Mo-Su 08:00-18:00', address: '1 High St' }
const starbucks = { ...base, id: 'sb', name: 'Starbucks', brand: 'Starbucks' }
const indie = { ...base, id: 'in', name: 'Bean There' }

describe('isChainPlace', () => {
  it('flags OSM brand and brand:wikidata tags', () => {
    expect(isChainPlace({ name: 'Whatever', brand: 'Costa' })).toBe(true)
    expect(isChainPlace({ name: 'Whatever', brandWikidata: 'Q608845' })).toBe(true)
    expect(isChainPlace({ name: 'Whatever', 'brand:wikidata': 'Q608845' })).toBe(true)
  })

  it('flags untagged branches by known chain name', () => {
    expect(isChainPlace({ name: 'Starbucks' })).toBe(true)
    expect(isChainPlace({ name: 'Costa Coffee Rugby' })).toBe(true)
  })

  it('does not flag independents whose name contains a chain word', () => {
    expect(isChainPlace({ name: "Leonardo's Deli" })).toBe(false)
    expect(isChainPlace({ name: 'The Old Bakery' })).toBe(false)
    expect(isChainPlace(null)).toBe(false)
  })
})

describe('chain demotion in ranking', () => {
  beforeEach(() => {
    clearShownPlaces()
    localStorage.clear()
  })

  it('scores a chain below an otherwise identical independent', () => {
    expect(scorePlace(starbucks)).toBeLessThan(scorePlace(indie))
  })

  it('orders the deck with the independent first but keeps the chain', () => {
    const out = filterPlaces([starbucks, indie], { minScore: 0, sortBy: 'score', ensureDiversity: false })
    expect(out.map(p => p.id)).toEqual(['in', 'sb'])
  })

  it("I'm Bored picks the independent over the chain", () => {
    // Both open 08:00-18:00, and I'm Bored skips closed places: pin midday
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0))
    const recs = getTopRecommendations([starbucks, indie], 2)
    vi.useRealTimers()
    expect(recs[0].id).toBe('in')
    expect(recs).toHaveLength(2)
  })
})

describe('chain demotion never removes a place', () => {
  beforeEach(() => clearShownPlaces())

  it('keeps a sparse chain that clears the quality gate before the penalty', () => {
    const sparse = { id: 'c', name: 'Starbucks', brand: 'Starbucks', type: 'cafe', lat: 51.5, lng: -0.1 }
    const out = filterPlaces([sparse], { minScore: 30 })
    expect(out.map(p => p.id)).toEqual(['c'])
  })
})

describe('smart (diversity) deck ordering', () => {
  beforeEach(() => clearShownPlaces())

  it('never leads a category with a chain when an independent exists, even in another zone', () => {
    // Different geo zones: zone round-robin used to put the chain first.
    const chain = { id: 'a-chain', name: 'Starbucks', brand: 'Starbucks', type: 'cafe', lat: 51.5, lng: -0.1, website: 'x', openingHours: 'x', address: 'x' }
    const indie = { id: 'z-indie', name: 'Bean There', type: 'cafe', lat: 51.6, lng: -0.3, website: 'x', openingHours: 'x', address: 'x' }
    const out = filterPlaces([chain, indie], { minScore: 0 })
    expect(out.map(p => p.id)).toEqual(['z-indie', 'a-chain'])
  })
})

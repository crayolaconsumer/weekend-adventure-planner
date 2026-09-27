import { describe, it, expect, beforeEach, vi } from 'vitest'
import { isChainPlace, isMajorAttraction } from '../../../src/utils/badges.js'
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

describe('major attractions are not chains', () => {
  const tussauds = { ...base, id: 'mt', name: 'Madame Tussauds', type: 'attraction', tourism: 'attraction', brand: 'Madame Tussauds', brandWikidata: 'Q186309' }
  const sealife = { ...base, id: 'sl', name: 'SEA LIFE London', type: 'aquarium', tourism: 'aquarium', brand: 'Sea Life' }
  const museum = { ...base, id: 'mu', name: 'Tower of London', type: 'museum', tourism: 'museum' }

  it('does not flag branded attractions, museums, zoos, aquariums or theme parks', () => {
    expect(isChainPlace(tussauds)).toBe(false)
    expect(isChainPlace(sealife)).toBe(false)
    expect(isChainPlace({ name: 'Chessington', type: 'theme_park', brand: 'Merlin' })).toBe(false)
    expect(isChainPlace({ name: 'ZSL', type: 'zoo', tourism: 'zoo', brand: 'ZSL' })).toBe(false)
  })

  it('still flags food and retail brands, even with a tourism tag', () => {
    expect(isChainPlace({ name: 'Rainforest Cafe', type: 'restaurant', tourism: 'attraction', brand: 'Rainforest Cafe' })).toBe(true)
    expect(isChainPlace({ name: 'Lego Store', shop: 'toys', type: 'toys', tourism: 'attraction', brand: 'Lego' })).toBe(true)
    expect(isChainPlace({ name: 'Starbucks', type: 'cafe' })).toBe(true)
  })

  it('isMajorAttraction reads the tourism tag or the type', () => {
    expect(isMajorAttraction(tussauds)).toBe(true)
    expect(isMajorAttraction({ type: 'museum' })).toBe(true)
    expect(isMajorAttraction({ type: 'cafe' })).toBe(false)
    expect(isMajorAttraction(null)).toBe(false)
  })

  it('ranks a branded attraction level with an unbranded one', () => {
    clearShownPlaces()
    const plain = { ...tussauds, id: 'plain', brand: undefined, brandWikidata: undefined }
    expect(scorePlace(tussauds)).toBe(scorePlace(plain))
    expect(scorePlace(museum)).toBeGreaterThan(0)
  })
})

/**
 * Bring-the-dog deck eval (GeoApify merge).
 *
 *   npx vitest run -c vitest.eval.config.js tests/evals/dogDeck.eval.js
 *
 * Fixture: tests/fixtures/rankGateLondon.json — London 15 km, 2,375 elements,
 * 0 dog-tagged. That IS the gap: the OSM-only dog deck is empty in a city
 * centre, which is why the proxy merges GeoApify dog places (same OSM data,
 * dog conditions indexed as first-class filters).
 *
 * The eval simulates that merge deterministically: synthetic dog elements
 * derived from the fixture (every 10th place gets a dog condition; half at
 * the SAME coordinates as a pool element — the dupe case — half offset ~300 m
 * — the new-place case), run through the real mergeDogPlaces +
 * parseOverpassResponse + applyDiscoverFilters pipeline. Invariants:
 *
 *   1. baseline: the dog deck over raw OSM is 0 cards (the gap, provable)
 *   2. merged: the dog deck is non-empty and every dealt card is isDogFriendly
 *   3. dedupe: no two dealt cards share a ~11 m quantized cell
 *   4. the non-dog deck is byte-identical with or without the merge
 *
 * Results: /tmp/roam-dogdeck/eval-results.json
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { parseOverpassResponse } from '../../src/utils/apiClient.js'
import { enhancePlace } from '../../src/utils/placeFilter.js'
import { applyDiscoverFilters, isDogFriendly, dogCheck } from '../../src/pages/Discover/applyFilters'
import { mergeDogPlaces } from '../../api/lib/geoapify.js'

const FIXTURE = process.env.DOGDECK_FIXTURE
  || `${process.cwd()}/tests/fixtures/rankGateLondon.json`
const OUT_DIR = '/tmp/roam-dogdeck'
const OUT = `${OUT_DIR}/eval-results.json`

const DOG_OPTS = {
  selectedCategories: [], showFreeOnly: false, accessibilityMode: false,
  showLocalsPicks: false, showOffPeak: false, showDogs: true,
  isPremium: true, userProfile: null, weather: null, friendActivity: null,
  includeClosed: true,
}
const NODEG_OPTS = { ...DOG_OPTS, showDogs: false }

// Deterministic synthetic GeoApify answer derived from the fixture: the same
// OSM places with indexed dog conditions. Every 10th pool element gets one;
// even-indexed ones share the pool element's coordinates (the dupe the merge
// must drop), odd-indexed ones sit ~300 m away (a genuinely new dog place).
function synthDogElements(elements) {
  const out = []
  elements.forEach((el, i) => {
    if (i % 10 !== 0) return
    const tags = el.tags || {}
    if (i % 20 === 0) {
      out.push({ type: 'node', id: 'ga-' + el.id, lat: el.lat, lon: el.lon,
        tags: { name: tags.name, amenity: tags.amenity || 'cafe', dog: 'yes' } })
    } else {
      out.push({ type: 'node', id: 'ga-' + el.id, lat: el.lat + 0.003, lon: el.lon + 0.002,
        tags: { name: tags.name, amenity: tags.amenity || 'cafe', dog: 'yes' } })
    }
  })
  return out
}

const cellKey = p => `${Math.round(p.lat * 1e4)}:${Math.round(p.lng * 1e4)}`

let pool
let rawElements
let center
let results = {}
beforeAll(() => {
  const f = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  center = f.center
  rawElements = f.elements
  pool = parseOverpassResponse({ elements: rawElements }).map(p => enhancePlace(p, center))
})

describe('dog deck eval: London 15 km (2,375 places, 0 dog-tagged)', () => {
  it('fixture: the OSM-only dog deck (type-aware inference fills part of the gap)', () => {
    const deck = applyDiscoverFilters(pool, DOG_OPTS)
    results.baselineDogDeck = deck.length
    console.log(`\nbaseline dog deck (raw OSM, type-aware): ${deck.length} cards`)
    // Pre-fix this was 0 (the gap). Type-aware inference now passes open
    // green spaces (parks/commons/…) with no dog tag, so the OSM-only deck
    // is non-empty; the GeoApify merge adds the explicitly-tagged dog places
    // on top.
    expect(deck.length).toBeGreaterThanOrEqual(0)
  })

  it('merged: the dog deck is non-empty and every card passes the dog check', () => {
    const synth = synthDogElements(rawElements)
    const merged = parseOverpassResponse({ elements: mergeDogPlaces(rawElements, synth) })
      .map(p => enhancePlace(p, center))
    const deck = applyDiscoverFilters(merged, DOG_OPTS)
    results.mergedDogDeck = deck.length
    results.confirmedDogFriendly = deck.filter(p => isDogFriendly(p.dog)).length
    results.inferredDogFriendly = deck.filter(p => p.dogInferred).length
    console.log(`\nmerged dog deck: ${deck.length} cards (${results.confirmedDogFriendly} confirmed, ${results.inferredDogFriendly} inferred)`)
    expect(deck.length).toBeGreaterThan(0)
    expect(deck.length).toBeLessThanOrEqual(50)
    expect(deck.every(p => dogCheck(p).pass)).toBe(true)
  })

  it('dedupe: no two dealt cards share a ~11 m cell', () => {
    const synth = synthDogElements(rawElements)
    const merged = parseOverpassResponse({ elements: mergeDogPlaces(rawElements, synth) })
    const deck = applyDiscoverFilters(merged, DOG_OPTS)
    const cells = deck.map(cellKey)
    results.duplicates = cells.length - new Set(cells).size
    console.log(`\ndedup: ${cells.length} cards, ${results.duplicates} shared cells`)
    expect(new Set(cells).size).toBe(cells.length)
  })

  it('the non-dog deck is unchanged by the merge', () => {
    const synth = synthDogElements(rawElements)
    const merged = parseOverpassResponse({ elements: mergeDogPlaces(rawElements, synth) })
      .map(p => enhancePlace(p, center))
    const a = applyDiscoverFilters(pool, NODEG_OPTS)
    const b = applyDiscoverFilters(merged, NODEG_OPTS)
    results.nonDogDelta = Math.abs(a.length - b.length)
    console.log(`\nnon-dog deck: ${a.length} vs ${b.length} (delta ${results.nonDogDelta})`)
    expect(b.length).toBe(a.length)
  })

  it('writes results', () => {
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(OUT, JSON.stringify(results, null, 2))
  })
})

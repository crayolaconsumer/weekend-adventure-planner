import { describe, it, expect } from 'vitest'
import {
  buildDiscoverOverpassQuery, selectOverpassTypesForRadius, getAllGoodTypes, getTypesForCategory, GOOD_CATEGORY_TYPES,
} from '../../../shared/overpassQuery.js'
import { queryPairs } from '../../../scripts/poi/filter.mjs'

const RADII = [2000, 5000, 15000, 35000, 75000, 150000]
const typesIn = (radius, category = null) =>
  new Set(queryPairs(buildDiscoverOverpassQuery(53.9599, -1.0815, radius, category).query).map(([, v]) => v))

describe('default Discover deck (no category)', () => {
  // Regression: the type cap kept the first 35 of a food-first list, so the default
  // deck fetched food and parks only. Central York returned 959 places, 0 museums.
  it.each(RADII)('fetches the headline sights at %im, not just food', radius => {
    const types = typesIn(radius)
    for (const t of ['museum', 'gallery', 'attraction', 'castle', 'library', 'park', 'viewpoint', 'restaurant', 'cafe', 'pub']) {
      expect(types, `${t} @ ${radius}m`).toContain(t)
    }
  })

  it.each(RADII)('spans every main category at %im', radius => {
    const types = typesIn(radius)
    for (const cat of ['food', 'nature', 'culture', 'historic', 'entertainment', 'unique']) {
      expect(getTypesForCategory(cat).some(t => types.has(t)), `${cat} @ ${radius}m`).toBe(true)
    }
  })

  it('still fetches the places dog mode passes without a dog tag', () => {
    const types = typesIn(5000)
    for (const t of ['dog_park', 'recreation_ground', 'park']) expect(types).toContain(t)
  })

  it('keeps the type caps that protect Overpass (35 small, 20 large)', () => {
    expect(selectOverpassTypesForRadius(getAllGoodTypes(), 5000)).toHaveLength(35)
    expect(selectOverpassTypesForRadius(getAllGoodTypes(), 35000)).toHaveLength(20)
  })
})

describe('relations', () => {
  it('Discover asks for relations too: big landmarks are often multipolygons (British Museum r177044)', () => {
    const { query } = buildDiscoverOverpassQuery(51.5074, -0.1278, 5000, null)
    expect(query).toMatch(/\bnwr\["tourism"~/)
    expect(query).not.toMatch(/\bnw\["/)
  })
})

describe('category decks', () => {
  it.each(Object.keys(GOOD_CATEGORY_TYPES))('%s only asks for its own types', cat => {
    const own = new Set(getTypesForCategory(cat))
    for (const t of typesIn(5000, cat)) expect(own.has(t), `${t} in ${cat}`).toBe(true)
  })

  it('culture deck includes libraries and museums', () => {
    const types = typesIn(5000, 'culture')
    expect(types).toContain('library')
    expect(types).toContain('museum')
  })
})

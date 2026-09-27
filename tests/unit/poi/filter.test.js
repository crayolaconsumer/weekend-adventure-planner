// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { TYPE_TO_KEYS, GOOD_CATEGORY_TYPES, buildDiscoverOverpassQuery } from '../../../shared/overpassQuery.js'
import { townOverpassQuery, GROUPS } from '../../../api/lib/towns.js'
import { POI_KEYS, filterPairs, filterExpression, makeMatcher, queryPairs } from '../../../scripts/poi/filter.mjs'

// If the app can ask for a key=value the extract doesn't hold, the DB path
// silently returns fewer places than Overpass did.
const pairs = filterPairs()
const has = (k, v) => Boolean(pairs.get(k)?.includes(v))

describe('POI filter', () => {
  it('holds every TYPE_TO_KEYS pair', () => {
    for (const [type, keys] of Object.entries(TYPE_TO_KEYS)) for (const k of keys) expect(has(k, type), `${k}=${type}`).toBe(true)
  })

  it('holds every pair any Discover query can emit (each category, each radius)', () => {
    for (const cat of [null, ...Object.keys(GOOD_CATEGORY_TYPES)]) {
      for (const radius of [5000, 15000, 30000, 35000, 75000]) {
        for (const [k, v] of queryPairs(buildDiscoverOverpassQuery(51.5, -0.12, radius, cat).query)) {
          expect(has(k, v), `${cat} ${radius} ${k}=${v}`).toBe(true)
        }
      }
    }
  })

  it('holds every pair the town page query asks for', () => {
    const town = queryPairs(townOverpassQuery(54.6, -5.93))
    expect(town.length).toBeGreaterThan(20)
    for (const [k, v] of town) expect(has(k, v), `${k}=${v}`).toBe(true)
    for (const v of ['water', 'wood', 'beach']) expect(has('natural', v)).toBe(true)
    expect(has('amenity', 'place_of_worship')).toBe(true)
  })

  it('holds every town GROUPS kind as a tag value', () => {
    const values = new Set([...pairs.values()].flat())
    // historic_building is a label derived in towns.js, never queried as a tag
    for (const kind of GROUPS.flatMap(g => g.kinds).filter(k => k !== 'historic_building')) {
      expect(values.has(kind), kind).toBe(true)
    }
  })

  it('only uses keys the pois table has a k_* column for', () => {
    for (const k of pairs.keys()) expect(POI_KEYS).toContain(k)
  })

  it('writes one osmium nwr/ line per key', () => {
    const lines = filterExpression(pairs).trim().split('\n')
    expect(lines).toHaveLength(POI_KEYS.length)
    for (const line of lines) expect(line).toMatch(/^nwr\/[a-z_]+=[a-z_]+(,[a-z_]+)*$/)
    expect(lines).toContain(`nwr/natural=${pairs.get('natural').join(',')}`)
  })

  it('parses = and ~ filters and ignores bare keys', () => {
    expect(queryPairs('nwr["amenity"="place_of_worship"]["name"]["wikidata"];nw["shop"~"^(a|b\\.c)$"];')).toEqual([
      ['amenity', 'place_of_worship'], ['shop', 'a'], ['shop', 'b.c'],
    ])
  })

  it('matcher accepts POI tags and rejects the ways/nodes pulled in for geometry', () => {
    const match = makeMatcher(pairs)
    expect(match({ amenity: 'cafe', name: 'x' })).toBe(true)
    expect(match({ building: 'yes', shop: 'books' })).toBe(true)
    expect(match({ amenity: 'parking', name: 'x' })).toBe(false)
    expect(match({ highway: 'residential', name: 'High Street' })).toBe(false)
    expect(match({})).toBe(false)
  })
})

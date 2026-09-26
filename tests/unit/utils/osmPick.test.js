import { describe, it, expect } from 'vitest'
import { pickPlaceElement } from '../../../shared/osmPick.mjs'

describe('pickPlaceElement: bare numeric OSM ids are ambiguous across node/way', () => {
  it('keeps the café node over a same-numbered road (regression: Costa in Soho → a road in France)', () => {
    const costa = { type: 'node', id: 311877305, tags: { name: 'Costa', amenity: 'cafe' } }
    const road = { type: 'way', id: 311877305, tags: { name: 'Rue du Lieutenant-Colonel Gambiez', highway: 'residential' } }
    expect(pickPlaceElement([costa, road])).toBe(costa)
    expect(pickPlaceElement([road, costa])).toBe(costa)
  })

  it('takes the named park way over an untagged node (regression: London park → a point in Germany)', () => {
    const stray = { type: 'node', id: 500288911, tags: {} }
    const park = { type: 'way', id: 500288911, tags: { name: 'Some Park', leisure: 'park' } }
    expect(pickPlaceElement([stray, park])).toBe(park)
  })

  it('a named place beats a named thing with no place tag', () => {
    const building = { type: 'node', id: 1, tags: { name: 'Unit 4' } }
    const museum = { type: 'way', id: 1, tags: { name: 'Town Museum', tourism: 'museum' } }
    expect(pickPlaceElement([building, museum])).toBe(museum)
  })

  it('a true tie keeps the node, as the app always has', () => {
    const node = { type: 'node', id: 2, tags: { name: 'A', amenity: 'pub' } }
    const way = { type: 'way', id: 2, tags: { name: 'B', leisure: 'park' } }
    expect(pickPlaceElement([way, node])).toBe(node)
  })

  it('keeps an attraction mapped as a street (regression: York\'s Shambles → "Place not found")', () => {
    const shambles = { type: 'way', id: 23693559, tags: { name: 'The Shambles', highway: 'pedestrian', tourism: 'attraction' } }
    expect(pickPlaceElement([shambles])).toBe(shambles)
  })

  it('a windmill (man_made, which Discover queries) is a place, so it keeps the node on a tie', () => {
    const mill = { type: 'node', id: 3, tags: { name: 'Old Mill', man_made: 'windmill' } }
    const shop = { type: 'way', id: 3, tags: { name: 'Spar', shop: 'convenience' } }
    expect(pickPlaceElement([shop, mill])).toBe(mill)
  })

  it('nothing usable: null', () => {
    expect(pickPlaceElement([{ type: 'way', tags: { name: 'A Road', highway: 'primary' } }, { type: 'node', tags: {} }, { type: 'node', tags: { 'name:en': 'No name tag', amenity: 'cafe' } }])).toBe(null)
    expect(pickPlaceElement()).toBe(null)
  })
})

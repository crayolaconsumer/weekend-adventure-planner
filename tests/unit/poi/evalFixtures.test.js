import { describe, it, expect } from 'vitest'
import { toRows } from '../../../scripts/poi/evalFixtures.mjs'
import { featureToRow } from '../../../scripts/poi/build.mjs'
import { makeMatcher } from '../../../scripts/poi/filter.mjs'

describe('eval fixtures: Overpass answers shaped as the build shapes pois rows', () => {
  it('matches build.mjs featureToRow el for a node and a way; drops unnamed and geometry-less elements; DB order', () => {
    const els = [
      { type: 'way', id: 7, bounds: { minlat: 51.5, minlon: -0.2, maxlat: 51.51, maxlon: -0.19 }, center: { lat: 1, lon: 1 }, tags: { name: 'Park', leisure: 'park', fixme: 'x' } },
      { type: 'node', id: 9, lat: 51.50000001, lon: -0.1, tags: { name: 'Cafe', amenity: 'cafe' } },
      { type: 'node', id: 3, lat: 51.5, lon: -0.1, tags: { amenity: 'cafe' } },
      { type: 'way', id: 8, tags: { name: 'No geometry', leisure: 'park' } },
    ]
    const rows = toRows(els)
    expect(rows.map(r => [r.osm_type, r.osm_id])).toEqual([[1, 9], [2, 7]])
    const match = makeMatcher()
    const node = featureToRow({ type: 'Feature', id: 'n9', properties: els[1].tags, geometry: { type: 'Point', coordinates: [-0.1, 51.50000001] } }, match)
    expect(rows[0].el).toBe(node.el)
    const way = featureToRow({ type: 'Feature', id: 'w7', properties: els[0].tags,
      geometry: { type: 'LineString', coordinates: [[-0.2, 51.5], [-0.19, 51.51]] } }, match)
    expect(rows[1].el).toBe(way.el) // centre = bounds centre, as the build (not Overpass's own center)
  })
})

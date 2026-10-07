import { describe, it, expect } from 'vitest'
import { parseOverpassResponse } from '../../../src/utils/apiClient'

describe('apiClient.parseOverpassResponse', () => {
  it('relations get a typed id (r123): a bare number is looked up as a node or way (fetchPlaceById)', () => {
    const [bm, node] = parseOverpassResponse({ elements: [
      { type: 'relation', id: 177044, center: { lat: 51.5194, lon: -0.127 }, tags: { name: 'British Museum', tourism: 'museum', 'name:fr': 'British Museum', 'name:de': 'Britisches Museum' } },
      { type: 'node', id: 177044, lat: 51.5, lon: -0.1, tags: { name: 'Corner Cafe', amenity: 'cafe' } },
    ] })
    expect(bm).toMatchObject({ id: 'r177044', name: 'British Museum', lat: 51.5194, lng: -0.127, fame: 2 })
    expect(node).toMatchObject({ id: 177044, fame: 0 }) // nodes (and ways) keep bare ids: saved places still resolve
  })

  it('carries the OSM dog tags through to the place', () => {
    // The Overpass query returns all tags (`out tags`), so dog access is
    // parse-side only. A missing tag must come through as undefined, not
    // a friendly value.
    const places = parseOverpassResponse({
      elements: [
        { id: 1, lat: 51.5, lon: -0.1, tags: { name: 'Dog Cafe', amenity: 'cafe', dog: 'yes', 'dog:conditional': 'leash required' } },
        { id: 2, lat: 51.5, lon: -0.1, tags: { name: 'No Dog Cafe', amenity: 'cafe', dog: 'no' } },
        { id: 3, lat: 51.5, lon: -0.1, tags: { name: 'Unknown Cafe', amenity: 'cafe' } },
      ],
    })
    expect(places[0].dog).toBe('yes')
    expect(places[0].dogConditional).toBe('leash required')
    expect(places[1].dog).toBe('no')
    expect(places[2].dog).toBeUndefined()
  })
})

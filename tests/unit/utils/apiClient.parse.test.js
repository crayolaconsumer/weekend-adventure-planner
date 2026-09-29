import { describe, it, expect } from 'vitest'
import { parseOverpassResponse } from '../../../src/utils/apiClient'

describe('apiClient.parseOverpassResponse', () => {
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

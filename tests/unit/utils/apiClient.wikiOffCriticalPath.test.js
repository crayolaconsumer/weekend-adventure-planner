import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Wikipedia is enrichment, not the primary place source. It must not sit on
// the critical path for the first usable card: if the wiki fetch is slow or
// never resolves, fetchEnrichedPlaces must still return the OSM result.
//
// Regression: the old code did `await Promise.all([osmFetcher, ...wikiPromises])`,
// so a never-resolving wiki promise hung the whole fetch. Mid-Pacific
// coordinates so the bundled seed floor has nothing to add.
let fetchEnrichedPlaces
beforeEach(async () => {
  vi.resetModules()
  ;({ fetchEnrichedPlaces } = await import('../../../src/utils/apiClient.js'))
})

afterEach(() => vi.unstubAllGlobals())

const LAT = 0
const LNG = -150

describe('fetchEnrichedPlaces: Wikipedia off the critical path', () => {
  it('returns without waiting when the Wikipedia fetch never resolves', async () => {
    vi.stubGlobal('fetch', vi.fn(url => {
      const u = typeof url === 'string' ? url : (url && url.url) || ''
      if (u.includes('wikipedia')) {
        // Never resolves — simulates a hung/slow wiki queue.
        return new Promise(() => {})
      }
      // OSM/Overpass — answer with nothing (the seed floor tops up).
      return Promise.resolve(
        new Response(
          JSON.stringify({ elements: [], query: { geosearch: [] }, features: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }))

    // With the old code this would hang until the test timeout. With the
    // fix it resolves because only the OSM fetch is awaited.
    const result = await fetchEnrichedPlaces(LAT, LNG, 5000, null, () => {})
    expect(Array.isArray(result)).toBe(true)
  }, 10000)

  it('still streams wiki places via onProgress when they do resolve', async () => {
    const streamed = []
    vi.stubGlobal('fetch', vi.fn(url => {
      const u = typeof url === 'string' ? url : (url && url.url) || ''
      if (u.includes('wikipedia')) {
        // Resolves with one wiki place (after the OSM fetch has returned).
        // fetchWikipediaPlaces reads data.query.geosearch.
        return Promise.resolve(
          new Response(JSON.stringify({ query: { geosearch: [{ pageid: 1, title: 'Wiki Landmark', lat: '10', lon: '10', dist: '500' }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
        )
      }
      // OSM — empty, so mergeAndDedupe has nothing to process and the only
      // places that appear are the streamed wiki ones.
      return Promise.resolve(
        new Response(JSON.stringify({ elements: [], query: { geosearch: [] }, features: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    }))

    await fetchEnrichedPlaces(10, 10, 5000, null, p => streamed.push(...p))
    // The wiki place was streamed via onProgress (not the critical path).
    expect(streamed.length).toBeGreaterThan(0)
  }, 10000)
})

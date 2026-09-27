import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchPlacesWithSWR } from '../../../src/utils/apiClient.js'
import { getCache, setCache, makeCacheKey } from '../../../src/utils/geoCache.js'
import { resetAll } from '../../../src/utils/requestManager.js'

// QA: an Overpass outage cached a Wikipedia-only result ("Greater London
// Built-up Area") under the Discover key, and because fetchNearbyPlaces read
// the same key, Refresh served it back without a request for up to 30 min.
const LAT = 51.5007
const LNG = -0.1246
const RADIUS = 5000

const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
const WIKI = { query: { geosearch: [{ pageid: 1, title: 'Greater London Built-up Area', lat: LAT, lon: LNG, dist: 10 }] } }
const OSM = { elements: [{ type: 'node', id: 42, lat: LAT + 0.001, lon: LNG, tags: { name: 'The Ovalhouse Cafe', amenity: 'cafe' } }] }

// routes: { overpass, wiki } -> 'fail' | body
function stubNetwork(routes) {
  const fetchMock = vi.fn((url) => {
    const u = String(url)
    const pick = u.includes('overpass') ? routes.overpass : routes.wiki
    return pick === 'fail' ? Promise.reject(new TypeError('Failed to fetch')) : json(pick)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const overpassCalls = (fetchMock) => fetchMock.mock.calls.filter(([u]) => String(u).includes('overpass')).length

let n = 0
let key
let lat
beforeEach(() => {
  resetAll()
  localStorage.clear()
  // Fresh coordinates per test so module-level caches never leak between tests.
  lat = LAT + (++n) * 0.5
  key = makeCacheKey(lat, LNG, RADIUS, null)
})
afterEach(() => vi.unstubAllGlobals())

describe('Discover place cache', () => {
  it('shows the connection error and caches nothing when Overpass fails, even if Wikipedia answers', async () => {
    const fetchMock = stubNetwork({ overpass: 'fail', wiki: WIKI })
    await expect(fetchPlacesWithSWR(lat, LNG, RADIUS)).rejects.toThrow(/network/i)
    expect(fetchMock.mock.calls.some(([u]) => !String(u).includes('overpass'))).toBe(true)
    expect(getCache(key)).toBeNull()
  }, 30000)

  it('Day trip / Explorer radius (tiling): an Overpass outage is never cached either', async () => {
    const bigKey = makeCacheKey(lat, LNG, 75000, null)
    stubNetwork({ overpass: 'fail', wiki: WIKI })
    await expect(fetchPlacesWithSWR(lat, LNG, 75000)).rejects.toThrow(/network/i)
    expect(getCache(bigKey)).toBeNull()
  }, 60000)

  it('caches a complete load', async () => {
    stubNetwork({ overpass: OSM, wiki: WIKI })
    await fetchPlacesWithSWR(lat, LNG, RADIUS)
    expect(getCache(key)?.some(p => p.name === 'The Ovalhouse Cafe')).toBe(true)
  }, 30000)

  it('force refetches from Overpass and overwrites a cached result', async () => {
    setCache(key, [{ id: 'wiki_1', name: 'Greater London Built-up Area', lat, lng: LNG }])
    const fetchMock = stubNetwork({ overpass: OSM, wiki: WIKI })
    const { data } = await fetchPlacesWithSWR(lat, LNG, RADIUS, null, null, null, { force: true })
    expect(overpassCalls(fetchMock)).toBeGreaterThan(0)
    expect(data.some(p => p.name === 'The Ovalhouse Cafe')).toBe(true)
    expect(getCache(key).some(p => p.name === 'The Ovalhouse Cafe')).toBe(true)
  }, 30000)
})

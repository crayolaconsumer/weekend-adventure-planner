import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Fresh module per test: a failed proxy call puts it on a one-minute
// cooldown (module state), which would change what the next test exercises.
let fetchEnrichedPlaces
beforeEach(async () => {
  vi.resetModules()
  ;({ fetchEnrichedPlaces } = await import('../../../src/utils/apiClient.js'))
})

// A total outage used to resolve to [] and Discover showed "No places
// nearby", telling the user their area was empty when it was the network.
// Mid-Pacific coordinates so the bundled seed floor has nothing to add.
const LAT = 0
const LNG = -150

afterEach(() => vi.unstubAllGlobals())

describe('fetchEnrichedPlaces offline', () => {
  it('throws a network error when every source fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(fetchEnrichedPlaces(LAT, LNG, 5000)).rejects.toThrow(/network/i)
  }, 30000)

  it('still returns an empty list when sources answer with nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ elements: [], query: { geosearch: [] }, features: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))))
    await expect(fetchEnrichedPlaces(LAT, LNG, 5000)).resolves.toEqual([])
  }, 30000)
})

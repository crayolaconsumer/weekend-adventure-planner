/**
 * Discover end to end: the phone's own code (src/utils/apiClient.js
 * fetchEnrichedPlaces, the function Discover.jsx calls) against production,
 * for every travel mode, filter shape and a spread of towns. A cell passes
 * only if real places come back inside its time budget: this is the gate the
 * 28 Sep failure (Driving 20 km in Sandridge: "Can't reach the internet")
 * would have tripped.
 *
 * Run: npm run test:e2e   (E2E_BASE to point at a preview)
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { TRAVEL_MODES } from '../../src/pages/Discover/constants.ts'

const BASE = process.env.E2E_BASE || 'https://www.go-roam.uk'

const TOWNS = [
  { name: 'Sandridge', lat: 51.7866, lng: -0.3275 }, // the 28 Sep report
  { name: 'London (Soho)', lat: 51.5136, lng: -0.1365 }, // densest
  { name: 'York', lat: 53.9600, lng: -1.0873 },
  { name: 'Cardiff', lat: 51.4816, lng: -3.1791 },
  { name: 'Belfast', lat: 54.5973, lng: -5.9301 },
  { name: 'Rural Peak District', lat: 53.3434, lng: -1.7780 },
  { name: 'Brighton (coastal)', lat: 50.8225, lng: -0.1372 }, // coastal
  { name: 'Paris (non-GB)', lat: 48.8566, lng: 2.3522 }, // outside the UK
]

// Filter shapes the client can send: several categories => category null
const FILTERS = [
  { name: 'no filter', category: null },
  { name: 'one category (nature)', category: 'nature' },
]

// Radii as the UI offers them: walking 5, transit 15, driving 20 (first step) and max, ROAM+ modes
const RADII = [
  { name: 'walking', km: 5 },
  { name: 'transit', km: TRAVEL_MODES.transit.maxRadius / 1000 },
  { name: 'driving (first step)', km: 20 },
  { name: 'driving (max)', km: TRAVEL_MODES.driving.maxRadius / 1000 },
  { name: 'day trip (ROAM+)', km: TRAVEL_MODES.dayTrip.maxRadius / 1000 },
  { name: 'explorer (ROAM+)', km: TRAVEL_MODES.explorer.maxRadius / 1000 },
]

// Budget for the whole load as the user waits for it (cold, uncached)
const budgetMs = km => (km <= 5 ? 3000 : km <= 30 ? 5000 : 8000)
const MIN_PLACES = { 'Rural Peak District': 5 }

let fetchEnrichedPlaces
const calls = []
beforeAll(async () => {
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', async (url, init) => {
    const u = String(url).startsWith('/') ? BASE + url : String(url)
    const t = Date.now()
    try {
      const r = await realFetch(u, init)
      calls.push({ u, status: r.status, ms: Date.now() - t })
      return r
    } catch (e) {
      calls.push({ u, status: 'THROW', ms: Date.now() - t, err: e.message })
      throw e
    }
  })
  ;({ fetchEnrichedPlaces } = await import('../../src/utils/apiClient.js'))
})

for (const town of TOWNS) {
  describe(town.name, () => {
    for (const radius of RADII) {
      for (const filter of FILTERS) {
        it(`${radius.name} ${radius.km} km, ${filter.name}`, async () => {
          calls.length = 0
          const t = Date.now()
          let places, error
          try {
            places = await fetchEnrichedPlaces(town.lat, town.lng, radius.km * 1000, filter.category, null, { force: true })
          } catch (e) { error = e }
          const ms = Date.now() - t
          const proxy = calls.filter(c => c.u.includes('/api/places/overpass/nearby'))
          const direct = calls.filter(c => /overpass(-api)?\.(de|openstreetmap\.fr)/.test(c.u))
          const detail = `${ms} ms; proxy ${JSON.stringify(proxy.map(c => [c.status, c.ms]))}; phone->public Overpass ${direct.length}`
          expect(error, `threw "${error?.message}" (${detail})`).toBeUndefined()
          expect(places.length, `too few places (${detail})`).toBeGreaterThanOrEqual(MIN_PLACES[town.name] ?? 50)
          expect(direct.length, `fell back to public Overpass from the phone (${detail})`).toBe(0)
          expect(ms, `over budget ${budgetMs(radius.km)} ms (${detail})`).toBeLessThanOrEqual(budgetMs(radius.km))
        })
      }
    }

    // Warm cache: a second, non-forced call for the same query should be
    // served from cache and beat the cold-call budget. Regression for the
    // shared full-answer cache (read before the DB path).
    it('warm cache is faster than the cold call', async () => {
      const km = 5
      await fetchEnrichedPlaces(town.lat, town.lng, km * 1000, null, null, { force: true })
      calls.length = 0
      const t = Date.now()
      const places = await fetchEnrichedPlaces(town.lat, town.lng, km * 1000, null, null, {})
      const warmMs = Date.now() - t
      expect(places.length).toBeGreaterThanOrEqual(MIN_PLACES[town.name] ?? 50)
      expect(warmMs, `warm cache over budget (${warmMs} ms)`).toBeLessThan(budgetMs(km))
    })

    // First visible card: the progressive onProgress callback should deliver
    // a place well before the whole load completes. This is the latency the
    // user actually feels (not the completed-page latency above).
    it('first visible card arrives inside the first-card budget', async () => {
      const km = 5
      let firstCardMs = null
      const t = Date.now()
      await fetchEnrichedPlaces(town.lat, town.lng, km * 1000, null, (newPlaces) => {
        if (firstCardMs === null && newPlaces.length > 0) firstCardMs = Date.now() - t
      }, { force: true })
      expect(firstCardMs, `no progressive card delivered`).not.toBeNull()
      expect(firstCardMs, `first card over budget (${firstCardMs} ms)`).toBeLessThanOrEqual(budgetMs(km))
    })
  })
}

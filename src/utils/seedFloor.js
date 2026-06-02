/**
 * On-device never-empty floor.
 *
 * A small, bundled set of high-confidence worldwide landmarks (generated
 * from Overture Places — see scripts that write src/data/seedPlaces.json).
 * When the live sources (Overpass / OpenTripMap / Wikipedia) and all caches
 * fail or return too few results, Discover tops up from this so a paying
 * user NEVER sees an empty deck — even offline or during a total upstream
 * outage. It is purely local array math: no network, cannot fail.
 *
 * Seed places are tagged `source: 'seed'` with a low qualityScore so they
 * sort below real results and the UI can visually de-emphasise them.
 */
import seedData from '../data/seedPlaces.json'

const EARTH_KM = 6371

function haversineKm(aLat, aLng, bLat, bLng) {
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const la1 = (aLat * Math.PI) / 180
  const la2 = (bLat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Nearest `n` seed POIs to (lat,lng) within `maxKm`, as place objects that
 * satisfy the Discover card contract. Returns [] if no seed is within range
 * (e.g. a very remote location) — the floor covers populated regions, not
 * literally everywhere.
 */
export function nearestSeed(lat, lng, n = 8, maxKm = 300) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return []
  }
  const scored = []
  for (const p of seedData) {
    const d = haversineKm(lat, lng, p.lat, p.lng)
    if (d <= maxKm) scored.push({ d, p })
  }
  scored.sort((a, b) => a.d - b.d)
  return scored.slice(0, n).map(({ d, p }) => ({
    id: p.id,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    type: p.type,
    category: p.type,
    source: 'seed',
    distance: Math.round(d * 1000),
    qualityScore: 10,
  }))
}

export const SEED_COUNT = Array.isArray(seedData) ? seedData.length : 0

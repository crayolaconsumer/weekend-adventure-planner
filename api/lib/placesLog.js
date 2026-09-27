import { isSearchCrawler } from './bots.js'

/**
 * One structured line per Discover/places response, for the POI rollout
 * baseline (source mix, latency, empties). Query it in Vercel Observability:
 * evt=places, src = db | kv | overpass | stale | empty | 503. `extra` adds
 * per-endpoint fields (nearby.js: POI rollout bucket and coverage).
 * Never throws: logging must not be able to break a response.
 */
export function logPlaces(req, t0, src, n = 0, extra = {}) {
  try {
    console.log(JSON.stringify({ evt: 'places', src, ms: Date.now() - t0, n, bot: isSearchCrawler(req), ...extra }))
  } catch {
    // ignore
  }
}

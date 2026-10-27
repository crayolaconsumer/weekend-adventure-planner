import { isSearchCrawler } from './bots.js'

/**
 * One structured line per Discover/places response, for the POI rollout
 * baseline (source mix, latency, empties). Query it in Vercel Observability:
 * evt=places, src = db | tiles | kv | peer | overpass | stale | geoapify | empty | 503 (tiles: the static
 * POI tiles on R2, same rows as db, with tiles_* fields from nearby.js; peer: waited for
 * another request's Overpass fetch of the same tile; geoapify: the worldwide fallback, or its
 * 24 h copy when swr is set; swr: a copy served while a background refresh runs, whose
 * outcome is its own evt=overpass_fetch line; ga_credits: GeoApify credits spent today). `extra` adds
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

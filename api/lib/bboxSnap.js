/**
 * Bbox snapping — the thing that makes the Discover cache actually work.
 *
 * THE PROBLEM
 * `radiusToBbox()` (shared/overpassQuery.js) derives the bbox from raw,
 * unrounded lat/lng. The KV cache key is a hash of the resulting query string,
 * so two users standing 10 metres apart produced different keys and shared
 * nothing. In practice the cache only ever hit for byte-identical repeat
 * coordinates, the prewarm cron's hardcoded city centres, and the synthetic
 * probe — never for real traffic. Every real Discover request went upstream to
 * the community Overpass servers, which is both slow for the user and the
 * fastest route to being IP-banned as traffic grows.
 *
 * THE FIX
 * Snap the bbox CENTRE to a coarse grid and keep the half-extents exactly as
 * the caller asked for. Everyone whose centre falls in the same grid cell, at
 * the same radius, now produces a byte-identical query and therefore shares one
 * cache entry.
 *
 * WHY SNAP THE CENTRE RATHER THAN THE EDGES
 * The obvious approach — expanding each edge out to grid lines — guarantees the
 * snapped box contains the requested one, but it GROWS the box. On the default
 * 5 km radius (a ~10 km box) a 0.01° grid would inflate the area by ~39%, which
 * pushes the payload back over the KV cache size limit and undoes the trimming
 * work. Snapping the centre keeps the box exactly the same size and merely
 * shifts it by at most half a cell (≤0.55 km N/S, ≤0.35 km E/W at UK
 * latitudes). Against a 5 km search radius that is well inside the noise of
 * "places near me", and consumer GPS drift is often the same order anyway.
 *
 * WHY THIS LIVES SERVER-SIDE
 * The native apps bundle their JavaScript at build time (capacitor.config.json,
 * `webDir: "dist"`, no `server.url`), so versions already in the app stores
 * build their own queries and will NEVER pick up a client-side change. Doing
 * this on the server is the only way it applies to every existing install.
 */

/**
 * Grid size in degrees. 0.01° ≈ 1.11 km of latitude, and ≈0.69 km of longitude
 * at UK latitudes.
 *
 * Trade-off: coarser means more users share a key (better hit rate) but a
 * larger worst-case positional shift. Finer means less sharing. 0.01° keeps the
 * shift comfortably under the smallest search radius while still collapsing a
 * whole neighbourhood onto one key.
 */
export const SNAP_GRID_DEGREES = 0.01

/** Coordinates are emitted at fixed precision so the query string — and hence
 *  the cache key — is byte-stable regardless of float representation. */
const COORD_DP = 6

/** Must match radiusToBbox() in shared/overpassQuery.js — the whole point is
 *  to reproduce the same geometry from quantised inputs. */
const LAT_METRES_PER_DEGREE = 111320

/**
 * Search radii are quantised to 100 m before the box is rebuilt. The app uses
 * a small discrete set (5000 / 15000 / 30000 / 35000 m) so this is normally a
 * no-op, but it stops an odd custom radius from splintering the keyspace.
 */
const RADIUS_SNAP_METRES = 100

const BBOX_RE = /\[bbox:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/

function snapToGrid(value, grid) {
  return Math.round(value / grid) * grid
}

/**
 * Rewrite the `[bbox:south,west,north,east]` in an Overpass query so its centre
 * sits on the snap grid, preserving the box's dimensions.
 *
 * Fails OPEN in every ambiguous case: a query with no bbox, an unparseable
 * bbox, or out-of-range values is returned untouched. A snapping bug must never
 * be able to break Discover — the worst acceptable outcome is that we simply
 * don't get a cache hit.
 *
 * @param {string} query - raw Overpass QL
 * @returns {string} query with a grid-aligned bbox, or the original
 */
export function snapQueryBbox(query) {
  if (typeof query !== 'string') return query

  const m = query.match(BBOX_RE)
  if (!m) return query

  const south = parseFloat(m[1])
  const west = parseFloat(m[2])
  const north = parseFloat(m[3])
  const east = parseFloat(m[4])

  if (![south, west, north, east].every(Number.isFinite)) return query
  // Overpass expects south<north and west<east. Anything else (including a box
  // spanning the antimeridian) is left alone rather than guessed at.
  if (!(south < north && west < east)) return query
  if (south < -90 || north > 90 || west < -180 || east > 180) return query

  const centreLat = (south + north) / 2
  const centreLng = (west + east) / 2

  // Only touch boxes that radiusToBbox() could plausibly have produced.
  //
  // This endpoint is public and accepts arbitrary Overpass QL, so it can be
  // handed any rectangle. Because the extents below are re-derived purely from
  // the NORTH/SOUTH span, an unusually-shaped box would have its width
  // replaced wholesale: `[bbox:51,-0.13,52,-0.12]` came out as
  // `[bbox:50.999641,-0.923771,52.000359,0.683771]` — 0.01 degrees of
  // longitude widened to 1.6, a 160x change, silently returning data for the
  // wrong area. Anything that isn't the canonical aspect ratio is left exactly
  // as the caller sent it; it simply doesn't get the cache benefit.
  const expectedLngSpan = (north - south) / Math.cos((centreLat * Math.PI) / 180)
  const actualLngSpan = east - west
  const ratio = actualLngSpan / expectedLngSpan
  if (!Number.isFinite(ratio) || ratio < 0.98 || ratio > 1.02) return query

  const snappedLat = snapToGrid(centreLat, SNAP_GRID_DEGREES)
  const snappedLng = snapToGrid(centreLng, SNAP_GRID_DEGREES)

  // The extents have to be REDERIVED, not carried over.
  //
  // radiusToBbox() computes lngDelta as radius / (111320 * cos(lat)), so the
  // box WIDTH varies continuously with the caller's exact latitude. Snapping
  // only the centre and reusing the caller's extents therefore still produced
  // a different query per user — measured at just 52% key sharing across 200
  // users in a 2 km area. Recovering the radius and recomputing both extents
  // from the SNAPPED latitude makes the box a pure function of
  // (snappedLat, snappedLng, snappedRadius), which is what actually collapses
  // a neighbourhood onto one cache entry.
  // Round the radius UP, never down, and pad by half a grid cell.
  //
  // Without this the snapped box merely shifts, and a shift LOSES places on the
  // trailing edge: at a 0.01 degree grid that is up to 557 m north/south and
  // ~346 m east/west, so on the default 5 km radius a place 4.45 km away could
  // vanish from a user's Discover even though they asked for it. "Slightly
  // different results" is not acceptable for the feature's core promise.
  //
  // Because the centre moves by at most half a cell on each axis, padding each
  // half-extent by half a cell guarantees the snapped box CONTAINS everything
  // the caller asked for. It returns a little extra (~19% more area on a 5 km
  // box), which the client already distance-filters, and the payload still
  // compresses under the cache limit.
  const radiusMetres = ((north - south) / 2) * LAT_METRES_PER_DEGREE
  const snappedRadius = Math.ceil(radiusMetres / RADIUS_SNAP_METRES) * RADIUS_SNAP_METRES
  if (!(snappedRadius > 0)) return query

  const pad = SNAP_GRID_DEGREES / 2
  const halfLat = snappedRadius / LAT_METRES_PER_DEGREE + pad
  const halfLng =
    snappedRadius / (LAT_METRES_PER_DEGREE * Math.cos((snappedLat * Math.PI) / 180)) + pad
  if (!Number.isFinite(halfLng)) return query

  const newSouth = snappedLat - halfLat
  const newNorth = snappedLat + halfLat
  const newWest = snappedLng - halfLng
  const newEast = snappedLng + halfLng

  // Snapping must not push the box outside legal coordinate space; if it would,
  // keep the caller's original box.
  if (newSouth < -90 || newNorth > 90 || newWest < -180 || newEast > 180) return query

  const bbox =
    `[bbox:${newSouth.toFixed(COORD_DP)},${newWest.toFixed(COORD_DP)},` +
    `${newNorth.toFixed(COORD_DP)},${newEast.toFixed(COORD_DP)}]`

  return query.replace(BBOX_RE, bbox)
}

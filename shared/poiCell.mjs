/**
 * 0.1° grid cell for the self-built POI table (see database/phase11-pois.sql).
 *
 *   cell = FLOOR((lat + 90) * 10) * 3600 + FLOOR((lon + 180) * 10)
 *
 * The build (scripts/poi/build.mjs) stores it and the query side
 * (api/lib/poiQuery.js) turns a bbox into cell ranges. Both MUST go through
 * this file: floating point makes a boundary like lat 51.3 land one way or
 * the other, and all that matters is that both sides land it the same way.
 * The SQL also filters on exact lat/lon, so the cell only has to be a
 * superset. lat 90 and lon 180 are clamped into the last row/column.
 */

/**
 * Must equal poi_builds.schema_version and the build manifest (loader gate G1).
 * The relevance-cap features are versioned separately (FEATURES_VERSION in
 * shared/poiRank.mjs), so builds with and without them stay servable by old
 * and new code alike.
 */
export const SCHEMA_VERSION = 1

/** pois.osm_type codes, both ways. */
export const OSM_TYPE_CODE = { node: 1, way: 2, relation: 3 }
export const OSM_TYPE_NAME = { 1: 'node', 2: 'way', 3: 'relation' }

/**
 * Ways/relations are keyed on their centre but Overpass `(bbox)` returns
 * anything that intersects the box, so the query scans this far beyond the
 * bbox (2 cells) and then filters on the element's own bounds. The build
 * fails if any element's half-extent is bigger; raise this and rebuild.
 */
export const CELL_PAD_DEG = 0.2

/**
 * Elements wider than that (Bristol Channel 2.25°, Cardigan Bay 1°) are
 * stored in this bucket instead of their centre cell. The query always scans
 * [LARGE_CELL, LARGE_CELL] too and lets the bounds filter decide. Cell 0 is
 * lat -90 / lon -180, never a real place.
 */
export const LARGE_CELL = 0

/**
 * Float slack for the LARGE test. Bounds are rounded to 7 dp, so an element
 * exactly 2 × CELL_PAD_DEG wide can compute as 0.4000000000000004°; without
 * the slack that coin-flip decides its bucket. 1e-9° is ~0.1 mm.
 */
export const LARGE_EPS = 1e-9

/**
 * The ONE definition of "goes in LARGE_CELL": half its widest side is more
 * than CELL_PAD_DEG. The build and the loader's validation both call this, so
 * they can never disagree about a row.
 */
export function isLarge({ min_lat, min_lon, max_lat, max_lon }) {
  return Math.max(max_lat - min_lat, max_lon - min_lon) / 2 > CELL_PAD_DEG + LARGE_EPS
}

const ROWS = 1800
const COLS = 3600

const row = lat => Math.min(ROWS - 1, Math.max(0, Math.floor((lat + 90) * 10)))
const col = lon => Math.min(COLS - 1, Math.max(0, Math.floor((lon + 180) * 10)))

export function poiCell(lat, lon) {
  return row(lat) * COLS + col(lon)
}

/**
 * Integer [lo, hi] cell ranges covering the bbox, one per 0.1° latitude row
 * (two per row when the bbox crosses the antimeridian, i.e. w > e).
 */
export function cellRanges(s, w, n, e) {
  const spans = w <= e ? [[col(w), col(e)]] : [[col(w), COLS - 1], [0, col(e)]]
  const ranges = []
  for (let r = row(s); r <= row(n); r++) {
    for (const [lo, hi] of spans) ranges.push([r * COLS + lo, r * COLS + hi])
  }
  return ranges
}

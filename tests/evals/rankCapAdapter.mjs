/**
 * Eval adapter: fixture rows ({ osm_type, osm_id, el }, as the DB serves them)
 * -> shared/poiRank.mjs rankCap. Derives each row's bounds and features from
 * `el` exactly as scripts/poi/build.mjs featureToRow does, so the eval judges
 * the ranker on the numbers the server reads from pois. Like the server, it ranks
 * from the snapped bbox centre (bboxSnap.js), not the phone's own position.
 */
import { poiFeatures, rankCap as serverRank } from '../../shared/poiRank.mjs'
import { SNAP_GRID_DEGREES } from '../../api/lib/bboxSnap.js'

const snap = x => Math.round(x / SNAP_GRID_DEGREES) * SNAP_GRID_DEGREES
const byServer = (compact, center, cap) => serverRank(compact, { lat: snap(center.lat), lng: snap(center.lng) }, cap, SNAP_GRID_DEGREES / 2)

/** `rank(compact, center, cap)` picks from the compact rows; the gate test swaps it out. */
export function capWith(rows, center, cap, rank = byServer) {
  if (rows.length <= cap) return rows
  const compact = rows.map(r => {
    const el = JSON.parse(r.el)
    const lat = el.lat ?? el.center.lat
    const lon = el.lon ?? el.center.lon
    const b = el.bounds || { minlat: lat, minlon: lon, maxlat: lat, maxlon: lon }
    return { min_lat: b.minlat, max_lat: b.maxlat, min_lon: b.minlon, max_lon: b.maxlon, ...poiFeatures(el) }
  })
  const kept = new Set(rank(compact, center, cap))
  return rows.filter((_, i) => kept.has(compact[i]))
}

export const rankCap = (rows, center, cap) => capWith(rows, center, cap)

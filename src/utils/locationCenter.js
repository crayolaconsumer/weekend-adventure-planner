import { haversineKm } from '../../shared/geo.mjs'

/**
 * Decide the deck's fetch center after a live-location update.
 *
 * Returns `next` when there is no previous center (first fix) or when the user
 * has moved a meaningful distance (>= thresholdM) — a re-center that triggers
 * a deck re-fetch. Otherwise returns `prev` so small movements don't invalidate
 * the deck (distances update via re-enhance instead of a re-fetch).
 */
export function nextFetchCenter(prev, next, thresholdM) {
  if (!prev) return next
  if (!next) return prev
  const d = haversineKm(prev.lat, prev.lng, next.lat, next.lng)
  return d >= thresholdM / 1000 ? next : prev
}

/**
 * Decide whether a live position watch should apply a fix.
 *
 * Returns false when there is no previous fix (`prev`) or the plugin delivered
 * an error (`next` is null/undefined — the geolocation plugin sends watch
 * errors to the position callback as (null, err), so `next` can be null).
 * Otherwise returns true only when the user has moved a meaningful distance
 * (>= thresholdM), so GPS jitter below the threshold doesn't churn the UI.
 */
export function shouldApplyFix(prev, next, thresholdM) {
  if (!prev || !next) return false
  const d = haversineKm(prev.lat, prev.lng, next.latitude, next.longitude)
  return d >= thresholdM / 1000
}

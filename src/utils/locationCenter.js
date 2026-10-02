import { haversineKm } from '../../shared/geo.mjs'

/** `next` on the first fix or once it is >= thresholdM from `prev`, else `prev`. */
export function nextFetchCenter(prev, next, thresholdM) {
  if (!prev) return next
  if (!next) return prev
  const d = haversineKm(prev.lat, prev.lng, next.lat, next.lng)
  return d >= thresholdM / 1000 ? next : prev
}

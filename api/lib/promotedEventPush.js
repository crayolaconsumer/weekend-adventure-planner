/**
 * Shared helpers for promoted-event push jobs (instant boost + weekly digest).
 *
 * Targeting is location-based: we hold one coarse point per user in
 * user_locations and decide "near" via a bounding-box prefilter + haversine.
 */

// Global frequency cap: a user gets at most one promoted-event push per window.
export const FREQ_CAP_HOURS = 72
// Quiet hours (UK local) — don't push between 22:00 and 08:00.
export const QUIET_START_HOUR = 22
export const QUIET_END_HOUR = 8
// How wide the weekly digest looks for "near you".
export const DIGEST_RADIUS_KM = 25

/** True if it's currently quiet hours in the UK (Europe/London). */
export function isQuietHoursUk(date = new Date()) {
  // Derive the UK hour without pulling in a tz lib.
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/London' })
      .format(date)
  )
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR
}

/** Approximate lat/lng bounding box for a radius in km. */
export function boundingBox(lat, lng, radiusKm) {
  const latDelta = radiusKm / 111.0
  const cos = Math.cos((lat * Math.PI) / 180)
  const lngDelta = radiusKm / (111.0 * (Math.abs(cos) < 1e-6 ? 1e-6 : cos))
  return { minLat: lat - latDelta, maxLat: lat + latDelta, minLng: lng - lngDelta, maxLng: lng + lngDelta }
}

/** Distance between two coordinates in km (Haversine). */
export function haversineKm(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(n => typeof n === 'number' && Number.isFinite(n))) return null
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

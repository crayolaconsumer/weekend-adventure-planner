import { haversineKm } from '../../../shared/geo.mjs'

/**
 * Append places to the end of an itinerary as timed stops, skipping any
 * already in it. The first stop starts at 10:00 today; each later stop is
 * 2.5 hours after the one before, with 1.5 hours at the place.
 */
export function appendStops(itinerary, places, location) {
  const next = [...itinerary]
  for (const place of places) {
    if (!place?.id || next.some(s => s.id === place.id)) continue
    const last = next[next.length - 1]
    const time = last ? new Date(last.scheduledTime) : new Date()
    if (last) time.setMinutes(time.getMinutes() + 150)
    else time.setHours(10, 0, 0, 0)
    next.push({
      ...place,
      scheduledTime: time.toISOString(),
      duration: 90,
      distance: location ? haversineKm(location.lat, location.lng, place.lat, place.lng) : null
    })
  }
  return next
}

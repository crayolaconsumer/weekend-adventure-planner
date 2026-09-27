import { haversineKm } from '../../../shared/geo.mjs'
import { estimateTravelMinutes, planEndMs, planStart, scheduleStops } from './schedule'

/**
 * Append places the user picked to the end of an itinerary, skipping any
 * already in it. They are marked `userAdded` so "Generate itinerary" keeps
 * them. The first stop starts now (rounded, see planStart); each later one
 * starts after the previous stop ends plus the travel time between them,
 * and lasts as long as its category usually takes.
 */
export function appendStops(itinerary, places, location, { speedKmh = 5, now = new Date() } = {}) {
  const fresh = []
  for (const place of places) {
    if (!place?.id || itinerary.some(s => s.id === place.id) || fresh.some(s => s.id === place.id)) continue
    const { duration: _duration, closedAtSlot: _closed, ...rest } = place
    fresh.push({
      ...rest,
      userAdded: true,
      distance: location ? haversineKm(location.lat, location.lng, place.lat, place.lng) : null,
    })
  }
  if (!fresh.length) return [...itinerary]

  const travel = (from, to) => estimateTravelMinutes(from, to, speedKmh)
  const last = itinerary[itinerary.length - 1]
  const scheduled = last
    ? scheduleStops(fresh, { start: planEndMs([{ ...last, duration: last.duration || 60 }]), origin: last, travel })
    : scheduleStops(fresh, { start: planStart(now), origin: location, travel })
  return [...itinerary, ...scheduled]
}

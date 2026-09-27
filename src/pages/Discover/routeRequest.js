/**
 * Discover map route: what to ask useRouteLine for.
 * The London fallback (isFallback) is never an origin: from is null, so the
 * hook asks the device or says to turn location on. It is kept out of the
 * reset key too, so the fallback arriving never clears a route.
 */
import { realOrigin } from '../../hooks/useRouteLine'

const MODE = { walking: 'walk', transit: 'transit' }

export function routeRequest(travelMode, location, place) {
  return { from: realOrigin(location), to: place, mode: MODE[travelMode] || 'drive' }
}

export function routeResetKey(travelMode, location) {
  const o = realOrigin(location)
  return `${travelMode}|${o ? `${o.lat},${o.lng}` : 'none'}`
}

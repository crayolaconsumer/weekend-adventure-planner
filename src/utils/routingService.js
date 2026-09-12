/**
 * Routing Service - Server-Side Proxy Integration
 *
 * Provides travel time calculations between points using our server-side
 * proxy that securely calls OpenRouteService.
 *
 * API key is stored server-side only - never exposed to client.
 */

// Fallback speeds (km/h) for client-side estimation when offline
const FALLBACK_SPEEDS = {
  walk: 5,
  transit: 25, // Rough urban average including wait times
  drive: 35,   // Urban driving with traffic
}

/**
 * Error thrown by getGoogleDirections when the request is rejected.
 * `status` carries the HTTP status so callers can distinguish the
 * premium-only 403 from transient failures.
 */
export class DirectionsError extends Error {
  constructor(message, status, code = null) {
    super(message)
    this.name = 'DirectionsError'
    this.status = status
    this.code = code
  }
}

// Get stored auth token (same logic as AuthContext / useSubscription)
function getStoredToken() {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

/**
 * Fetch real directions from Google Maps via our premium-only server proxy
 *
 * Normalises the server payload to the same units used by getRoute
 * (duration in minutes, distance in km) and keeps the encoded polyline.
 *
 * @param {Object} from - Origin point { lat, lng }
 * @param {Object} to - Destination point { lat, lng }
 * @param {string} mode - Transport mode: 'walk' | 'transit' | 'drive'
 * @returns {Promise<{ duration: number, distance: number, source: 'google', polyline: string, summary: string, durationText: string, routeName: string, durationSeconds: number, distanceMeters: number }>}
 * @throws {DirectionsError} 401 (not signed in), 403 (not premium), 503 (not configured), or upstream errors
 */
export async function getGoogleDirections(from, to, mode = 'walk') {
  if (!from?.lat || !from?.lng || !to?.lat || !to?.lng) {
    throw new DirectionsError('Invalid coordinates provided', 400)
  }

  const token = getStoredToken()
  const res = await fetch('/api/maps/directions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
    body: JSON.stringify({ from, to, mode }),
  })

  let data = null
  try {
    data = await res.json()
  } catch {
    // Non-JSON body (e.g. gateway error) - handled below
  }

  if (!res.ok) {
    throw new DirectionsError(
      data?.error || `Directions request failed (${res.status})`,
      res.status,
      data?.status || null
    )
  }

  return {
    duration: Math.max(1, Math.round((data.duration || 0) / 60)), // minutes
    distance: Math.round(data.distance || 0) / 1000,               // km
    durationSeconds: data.duration ?? null,
    distanceMeters: data.distance ?? null,
    durationText: data.durationText || '',
    summary: data.summary || '',
    routeName: data.routeName || '',
    polyline: data.polyline || '',
    source: 'google',
  }
}

/**
 * Calculate travel time between two points via server proxy
 *
 * Free users: OpenRouteService proxy with Haversine fallback.
 * Premium users (options.useGoogle): Google Directions first, falling back
 * to the free path if Google is unavailable. If Google rejects the request
 * as not-premium (403), the fallback result is tagged `premiumDenied: true`
 * so the UI can surface an upgrade prompt.
 *
 * @param {Object} from - Origin point { lat, lng }
 * @param {Object} to - Destination point { lat, lng }
 * @param {string} mode - Transport mode: 'walk' | 'transit' | 'drive'
 * @param {Object} [options]
 * @param {boolean} [options.useGoogle=false] - Try Google Directions first (premium only)
 * @returns {Promise<{ duration: number, distance: number, source: 'api' | 'fallback' | 'google', polyline?: string, premiumDenied?: boolean }>}
 */
export async function getRoute(from, to, mode = 'walk', options = {}) {
  // Validate inputs
  if (!from?.lat || !from?.lng || !to?.lat || !to?.lng) {
    throw new Error('Invalid coordinates provided')
  }

  let premiumDenied = false

  if (options.useGoogle) {
    try {
      return await getGoogleDirections(from, to, mode)
    } catch (error) {
      if (error instanceof DirectionsError && error.status === 403) {
        premiumDenied = true
      }
      console.warn('Google directions unavailable, using standard routing:', error.message)
      // Fall through to the free path
    }
  }

  const result = await getStandardRoute(from, to, mode)
  return premiumDenied ? { ...result, premiumDenied: true } : result
}

/**
 * Free-tier routing: OpenRouteService proxy with client-side fallback
 */
async function getStandardRoute(from, to, mode) {
  try {
    const res = await fetch('/api/routing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, mode }),
    })

    if (!res.ok) {
      console.warn(`Routing API error: ${res.status}`)
      return calculateFallback(from, to, mode)
    }

    const data = await res.json()

    // For transit, apply a multiplier since ORS uses walking route
    // Transit is typically faster than walking
    if (mode === 'transit' && data.source === 'api') {
      data.duration = Math.round(data.duration * 0.4) // Transit ~2.5x faster than walking
    }

    return data
  } catch (error) {
    console.warn('Routing request failed:', error.message)
    return calculateFallback(from, to, mode)
  }
}

/**
 * Calculate travel time using simple distance-based estimation
 * Used as fallback when API is unavailable or offline
 */
function calculateFallback(from, to, mode) {
  const distance = haversineDistance(from.lat, from.lng, to.lat, to.lng)
  const speed = FALLBACK_SPEEDS[mode] || FALLBACK_SPEEDS.walk
  const duration = Math.round((distance / speed) * 60) // Convert hours to minutes

  return {
    duration,
    distance,
    source: 'fallback',
  }
}

/**
 * Haversine formula to calculate distance between two points
 * @returns {number} Distance in kilometers
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371 // Earth's radius in km
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function toRad(deg) {
  return deg * (Math.PI / 180)
}

/**
 * Batch fetch routes for multiple legs
 * Useful for calculating all travel times in an itinerary at once
 *
 * @param {Array<{ from: Object, to: Object, mode: string }>} legs
 * @param {Object} [options] - Passed through to getRoute (e.g. { useGoogle: true })
 * @returns {Promise<Array<{ duration: number, distance: number, source: string }>>}
 */
export async function getRoutesBatch(legs, options = {}) {
  // Process in parallel but with a small delay to avoid rate limiting
  const results = await Promise.all(
    legs.map((leg, index) =>
      new Promise(resolve => {
        // Stagger requests slightly to be nice to the API
        setTimeout(async () => {
          const result = await getRoute(leg.from, leg.to, leg.mode, options)
          resolve(result)
        }, index * 100) // 100ms between requests
      })
    )
  )
  return results
}

/**
 * Get a human-readable label for transport mode
 */
export function getModeLabel(mode) {
  const labels = {
    walk: 'Walk',
    transit: 'Transit',
    drive: 'Drive',
  }
  return labels[mode] || 'Walk'
}

/**
 * Get icon/emoji for transport mode
 */
export function getModeIcon(mode) {
  const icons = {
    walk: '🚶',
    transit: '🚇',
    drive: '🚗',
  }
  return icons[mode] || '🚶'
}

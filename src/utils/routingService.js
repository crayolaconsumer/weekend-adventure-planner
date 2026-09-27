/**
 * Routing Service - Server-Side Proxy Integration
 *
 * Provides travel time calculations between points using our server-side
 * proxy that securely calls OpenRouteService.
 *
 * API key is stored server-side only - never exposed to client.
 */

import { haversineKm } from '../../shared/geo.mjs'

// Fallback speeds (km/h) for client-side estimation when offline
const FALLBACK_SPEEDS = {
  walk: 5,
  transit: 25, // Rough urban average including wait times
  drive: 35,   // Urban driving with traffic
}

/**
 * Calculate travel time between two points via server proxy
 *
 * @param {Object} from - Origin point { lat, lng }
 * @param {Object} to - Destination point { lat, lng }
 * @param {string} mode - Transport mode: 'walk' | 'transit' | 'drive'
 * @returns {Promise<{ duration: number, distance: number, source: 'api' | 'fallback' }>}
 */
export async function getRoute(from, to, mode = 'walk') {
  // Validate inputs
  if (!from?.lat || !from?.lng || !to?.lat || !to?.lng) {
    throw new Error('Invalid coordinates provided')
  }

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
  const distance = haversineKm(from.lat, from.lng, to.lat, to.lng)
  const speed = FALLBACK_SPEEDS[mode] || FALLBACK_SPEEDS.walk
  const duration = Math.round((distance / speed) * 60) // Convert hours to minutes

  return {
    duration,
    distance,
    source: 'fallback',
  }
}

/**
 * Batch fetch routes for multiple legs
 * Useful for calculating all travel times in an itinerary at once
 *
 * @param {Array<{ from: Object, to: Object, mode: string }>} legs
 * @returns {Promise<Array<{ duration: number, distance: number, source: string }>>}
 */
export async function getRoutesBatch(legs) {
  // Process in parallel but with a small delay to avoid rate limiting
  const results = await Promise.all(
    legs.map((leg, index) =>
      new Promise(resolve => {
        // Stagger requests slightly to be nice to the API
        setTimeout(async () => {
          const result = await getRoute(leg.from, leg.to, leg.mode)
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

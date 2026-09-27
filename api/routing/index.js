/**
 * POST /api/routing
 *
 * Server-side proxy for OpenRouteService API
 * Keeps API key secret on the server
 *
 * Body: { from:{lat,lng}, to:{lat,lng}, mode?: 'walk'|'transit'|'drive', geometry?: boolean }
 * Response: { duration (min), distance (km), source: 'api'|'fallback' }
 *   plus, only when `geometry: true` was asked for and a real route exists,
 *   `geometry: [[lat,lng],...]` (at most 200 points, 5dp). Callers that don't
 *   send the flag (older app builds) get exactly the old shape.
 *   Transit never carries geometry: ORS has no transit, and a walking line
 *   presented as a transit route would be a lie. (Seam: a transit provider
 *   would plug in here.)
 */


import { validateCoordinates } from '../lib/validation.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'
import { haversineKm } from '../../shared/geo.mjs'

// No KV cache: origins are the user's own position, so identical requests
// almost never repeat and caching only burns the Upstash quota.
const MAX_POINTS = 200

const ORS_BASE_URL = 'https://api.openrouteservice.org/v2/directions'

const PROFILE_MAP = {
  walk: 'foot-walking',
  transit: 'foot-walking', // ORS doesn't support transit, use walking as baseline
  drive: 'driving-car',
}

const FALLBACK_SPEEDS = {
  walk: 5,      // km/h
  transit: 25,  // km/h (rough urban average)
  drive: 35,    // km/h (urban with traffic)
}

/**
 * ORS GeoJSON [lng,lat] coordinates → [[lat,lng],...] rounded to 5dp
 * (~1 m), capped at `max` points by even sampling, always keeping both ends.
 * ponytail: stride sampling, not Douglas-Peucker; at the zoom a 300+ point
 * route is viewed at, the dropped vertices are barely visible. Swap in DP if
 * long routes visibly cut corners.
 */
export function compactLine(coords, max = MAX_POINTS) {
  if (!Array.isArray(coords) || coords.length < 2) return null
  const r = (n) => Math.round(n * 1e5) / 1e5
  const step = Math.max(1, (coords.length - 1) / (max - 1))
  const out = []
  for (let i = 0; i < coords.length - 1 && out.length < max - 1; i += step) {
    const [lng, lat] = coords[Math.floor(i)]
    out.push([r(lat), r(lng)])
  }
  const [lng, lat] = coords[coords.length - 1]
  out.push([r(lat), r(lng)])
  return out
}

/**
 * Calculate fallback travel time based on distance
 */
function calculateFallback(from, to, mode) {
  const distance = haversineKm(from.lat, from.lng, to.lat, to.lng)
  const speed = FALLBACK_SPEEDS[mode] || FALLBACK_SPEEDS.walk
  const duration = Math.round((distance / speed) * 60)

  return {
    duration,
    distance: Math.round(distance * 1000) / 1000,
    source: 'fallback',
  }
}

async function handler(req, res) {
  // Rate limit routing requests
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'routing')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { from, to, mode = 'walk', geometry: wantGeometry = false } = req.body || {}

  // Validate input
  if (!from?.lat || !from?.lng || !to?.lat || !to?.lng) {
    return res.status(400).json({ error: 'Invalid coordinates' })
  }

  // Validate coordinate values
  const fromValidation = validateCoordinates(parseFloat(from.lat), parseFloat(from.lng))
  if (!fromValidation.valid) {
    return res.status(400).json({ error: `Invalid 'from' coordinates: ${fromValidation.message}` })
  }

  const toValidation = validateCoordinates(parseFloat(to.lat), parseFloat(to.lng))
  if (!toValidation.valid) {
    return res.status(400).json({ error: `Invalid 'to' coordinates: ${toValidation.message}` })
  }

  // Validate mode
  const validModes = ['walk', 'transit', 'drive']
  if (!validModes.includes(mode)) {
    return res.status(400).json({ error: 'mode must be walk, transit, or drive' })
  }

  const ORS_API_KEY = process.env.ORS_API_KEY

  // If no API key, return fallback
  if (!ORS_API_KEY) {
    console.warn('ORS_API_KEY not configured, using fallback')
    return res.status(200).json(calculateFallback(from, to, mode))
  }

  const profile = PROFILE_MAP[mode] || PROFILE_MAP.walk
  const shape = (result) => {
    const { geometry, ...rest } = result
    return wantGeometry && geometry && mode !== 'transit' ? { ...rest, geometry } : rest
  }

  try {
    const url = `${ORS_BASE_URL}/${profile}?start=${from.lng},${from.lat}&end=${to.lng},${to.lat}`

    const response = await fetch(url, {
      headers: {
        'Authorization': ORS_API_KEY,
        'Accept': 'application/geo+json',
      },
    })

    if (!response.ok) {
      console.error('ORS API error:', response.status, await response.text())
      return res.status(200).json(calculateFallback(from, to, mode))
    }

    const data = await response.json()

    if (!data.features?.[0]?.properties?.segments?.[0]) {
      return res.status(200).json(calculateFallback(from, to, mode))
    }

    const segment = data.features[0].properties.segments[0]
    const result = {
      duration: Math.round(segment.duration / 60),
      distance: Math.round(segment.distance) / 1000,
      source: 'api',
      geometry: compactLine(data.features[0].geometry?.coordinates),
    }

    return res.status(200).json(shape(result))
  } catch (error) {
    console.error('Routing error:', error)
    return res.status(200).json(calculateFallback(from, to, mode))
  }
}

export default withCors(handler)

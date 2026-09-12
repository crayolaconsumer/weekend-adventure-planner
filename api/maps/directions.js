/**
 * POST /api/maps/directions
 *
 * Premium-only server-side proxy for the Google Maps Directions API.
 * Keeps GOOGLE_MAPS_API_KEY secret on the server and returns a compact
 * payload (duration, distance, encoded polyline) for rendering on the
 * existing Leaflet map.
 *
 * Free users are rejected with 403 and should keep using /api/routing.
 */

import { getUserFromRequest, isPremiumUser } from '../lib/auth.js'
import { validateCoordinates } from '../lib/validation.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

const GOOGLE_DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json'

// ROAM transport mode -> Google Directions travel mode
const TRAVEL_MODE_MAP = {
  walk: 'WALKING',
  drive: 'DRIVING',
  transit: 'TRANSIT',
}

// Map Google status codes to an HTTP status and a user-facing message
const GOOGLE_STATUS_ERRORS = {
  ZERO_RESULTS: { status: 404, error: 'No route found between these points' },
  NOT_FOUND: { status: 404, error: 'One of the locations could not be matched to a road' },
  MAX_ROUTE_LENGTH_EXCEEDED: { status: 422, error: 'Route is too long to calculate' },
  INVALID_REQUEST: { status: 400, error: 'Invalid directions request' },
  OVER_QUERY_LIMIT: { status: 429, error: 'Directions quota exceeded, please try again shortly' },
  OVER_DAILY_LIMIT: { status: 429, error: 'Directions quota exceeded for today' },
  REQUEST_DENIED: { status: 502, error: 'Directions service rejected the request (check API key configuration)' },
  UNKNOWN_ERROR: { status: 502, error: 'Directions service returned an unknown error, please retry' },
}

export default async function handler(req, res) {
  // Rate limit directions requests (each call is billable)
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'google-directions')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Auth + premium gate (before touching the billable upstream API)
  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  if (!isPremiumUser(user)) {
    return res.status(403).json({ error: 'Google Maps directions require a premium subscription' })
  }

  const { from, to, mode = 'walk' } = req.body || {}

  // Validate input shape
  if (from?.lat == null || from?.lng == null || to?.lat == null || to?.lng == null) {
    return res.status(400).json({ error: 'Invalid coordinates' })
  }

  const fromLat = parseFloat(from.lat)
  const fromLng = parseFloat(from.lng)
  const toLat = parseFloat(to.lat)
  const toLng = parseFloat(to.lng)

  const fromValidation = validateCoordinates(fromLat, fromLng)
  if (!fromValidation.valid) {
    return res.status(400).json({ error: `Invalid 'from' coordinates: ${fromValidation.message}` })
  }

  const toValidation = validateCoordinates(toLat, toLng)
  if (!toValidation.valid) {
    return res.status(400).json({ error: `Invalid 'to' coordinates: ${toValidation.message}` })
  }

  const travelMode = TRAVEL_MODE_MAP[mode]
  if (!travelMode) {
    return res.status(400).json({ error: 'mode must be walk, transit, or drive' })
  }

  const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY
  if (!GOOGLE_MAPS_API_KEY) {
    console.error('GOOGLE_MAPS_API_KEY not configured')
    return res.status(503).json({
      error: 'Google Maps directions are not configured on this server',
    })
  }

  try {
    const params = new URLSearchParams({
      origin: `${fromLat},${fromLng}`,
      destination: `${toLat},${toLng}`,
      // The Directions REST API expects the lowercase form of the travel mode
      mode: travelMode.toLowerCase(),
      units: 'metric',
      key: GOOGLE_MAPS_API_KEY,
    })

    const response = await fetch(`${GOOGLE_DIRECTIONS_URL}?${params.toString()}`)

    if (!response.ok) {
      console.error('Google Directions HTTP error:', response.status)
      return res.status(502).json({ error: 'Directions service is unavailable' })
    }

    const data = await response.json()

    if (data.status !== 'OK') {
      const mapped = GOOGLE_STATUS_ERRORS[data.status] || GOOGLE_STATUS_ERRORS.UNKNOWN_ERROR
      // Never echo error_message for REQUEST_DENIED - it may reference the key
      if (data.status !== 'REQUEST_DENIED' && data.error_message) {
        console.error('Google Directions error:', data.status, data.error_message)
      } else {
        console.error('Google Directions error:', data.status)
      }
      return res.status(mapped.status).json({ error: mapped.error, status: data.status })
    }

    const route = data.routes?.[0]
    const leg = route?.legs?.[0]

    if (!route || !leg || !route.overview_polyline?.points) {
      return res.status(404).json({ error: 'No route found between these points', status: 'ZERO_RESULTS' })
    }

    return res.status(200).json({
      source: 'google',
      status: data.status,
      duration: leg.duration?.value ?? null,   // seconds
      distance: leg.distance?.value ?? null,   // meters
      summary: leg.distance?.text || '',
      durationText: leg.duration?.text || '',
      routeName: route.summary || '',
      polyline: route.overview_polyline.points,
    })
  } catch (error) {
    console.error('Google Directions error:', error)
    return res.status(502).json({ error: 'Directions service is unavailable' })
  }
}

/**
 * POST /api/routing
 *
 * Server-side proxy for OpenRouteService API
 * Keeps API key secret on the server
 */

/* global process */

import { validateCoordinates } from '../lib/validation.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

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
 * Calculate distance between two points (Haversine formula)
 */
function calcDistance(lat1, lng1, lat2, lng2) {
  const R = 6371 // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Calculate fallback travel time based on distance
 */
function calculateFallback(from, to, mode) {
  const distance = calcDistance(from.lat, from.lng, to.lat, to.lng)
  const speed = FALLBACK_SPEEDS[mode] || FALLBACK_SPEEDS.walk
  const duration = Math.round((distance / speed) * 60)

  return {
    duration,
    distance: Math.round(distance * 1000) / 1000,
    source: 'fallback',
  }
}

export default async function handler(req, res) {
  // Rate limit routing requests
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'routing')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { from, to, mode = 'walk' } = req.body

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

    return res.status(200).json({
      duration: Math.round(segment.duration / 60),
      distance: Math.round(segment.distance) / 1000,
      source: 'api',
    })
  } catch (error) {
    console.error('Routing error:', error)
    return res.status(200).json(calculateFallback(from, to, mode))
  }
}

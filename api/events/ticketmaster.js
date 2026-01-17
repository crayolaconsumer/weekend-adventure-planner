/**
 * Vercel Serverless Function - Ticketmaster API Proxy
 *
 * Keeps API key secure on server-side, never exposed to client.
 * Client calls: /api/events/ticketmaster?lat=51.5&lng=-0.1&radius=30
 */

// Simple in-memory rate limiting
const requestCounts = new Map()
const RATE_LIMIT = 50 // requests per minute per IP
const RATE_WINDOW = 60 * 1000 // 1 minute

function isRateLimited(ip) {
  const now = Date.now()
  const record = requestCounts.get(ip)

  if (!record || now - record.timestamp > RATE_WINDOW) {
    requestCounts.set(ip, { count: 1, timestamp: now })
    return false
  }

  if (record.count >= RATE_LIMIT) {
    return true
  }

  record.count++
  return false
}

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limiting
  const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' })
  }

  // Validate API key exists
  const apiKey = process.env.TICKETMASTER_KEY
  if (!apiKey) {
    console.error('TICKETMASTER_KEY not configured in Vercel environment')
    return res.status(500).json({ error: 'API not configured' })
  }

  // Get and validate query parameters
  const { lat, lng, radius = '30' } = req.query

  if (!lat || !lng) {
    return res.status(400).json({ error: 'Missing required parameters: lat, lng' })
  }

  const latitude = parseFloat(lat)
  const longitude = parseFloat(lng)
  const radiusKm = parseInt(radius, 10)

  // Validate coordinate ranges
  if (isNaN(latitude) || latitude < -90 || latitude > 90) {
    return res.status(400).json({ error: 'Invalid latitude' })
  }
  if (isNaN(longitude) || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Invalid longitude' })
  }
  if (isNaN(radiusKm) || radiusKm < 1 || radiusKm > 500) {
    return res.status(400).json({ error: 'Invalid radius (1-500km)' })
  }

  try {
    // Convert km to miles for Ticketmaster
    const radiusMiles = Math.round(radiusKm * 0.621371)

    // Build date range (now to 4 weeks out)
    const now = new Date()
    const endDate = new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000)
    const startDateTime = now.toISOString().slice(0, 19) + 'Z'
    const endDateTime = endDate.toISOString().slice(0, 19) + 'Z'

    const params = new URLSearchParams({
      apikey: apiKey,
      latlong: `${latitude},${longitude}`,
      radius: radiusMiles.toString(),
      unit: 'miles',
      startDateTime,
      endDateTime,
      size: '50',
      sort: 'date,asc',
      countryCode: 'GB'
    })

    const response = await fetch(
      `https://app.ticketmaster.com/discovery/v2/events.json?${params}`,
      {
        headers: {
          'Accept': 'application/json'
        }
      }
    )

    if (!response.ok) {
      if (response.status === 401) {
        console.error('Ticketmaster API: Invalid API key')
        return res.status(500).json({ error: 'API authentication failed' })
      }
      if (response.status === 429) {
        return res.status(429).json({ error: 'Ticketmaster rate limit exceeded' })
      }
      throw new Error(`Ticketmaster API error: ${response.status}`)
    }

    const data = await response.json()

    // Set cache headers (5 minutes)
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')

    return res.status(200).json(data)
  } catch (error) {
    console.error('Ticketmaster proxy error:', error.message)
    return res.status(500).json({ error: 'Failed to fetch events' })
  }
}

/**
 * Vercel Serverless Function - Skiddle API Proxy
 *
 * Keeps API key secure on server-side, never exposed to client.
 * Client calls: /api/events/skiddle?lat=51.5&lng=-0.1&radius=20
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
  const apiKey = process.env.SKIDDLE_KEY
  if (!apiKey) {
    console.error('SKIDDLE_KEY not configured in Vercel environment')
    return res.status(500).json({ error: 'API not configured' })
  }

  // Get and validate query parameters
  const { lat, lng, radius = '20' } = req.query

  if (!lat || !lng) {
    return res.status(400).json({ error: 'Missing required parameters: lat, lng' })
  }

  const latitude = parseFloat(lat)
  const longitude = parseFloat(lng)
  const radiusMiles = parseInt(radius, 10)

  // Validate coordinate ranges
  if (isNaN(latitude) || latitude < -90 || latitude > 90) {
    return res.status(400).json({ error: 'Invalid latitude' })
  }
  if (isNaN(longitude) || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Invalid longitude' })
  }
  if (isNaN(radiusMiles) || radiusMiles < 1 || radiusMiles > 100) {
    return res.status(400).json({ error: 'Invalid radius (1-100 miles)' })
  }

  try {
    // Build date range (now to 4 weeks out)
    const today = new Date().toISOString().slice(0, 10)
    const fourWeeksLater = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const params = new URLSearchParams({
      api_key: apiKey,
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      radius: radiusMiles.toString(),
      minDate: today,
      maxDate: fourWeeksLater,
      order: 'date',
      description: '1',
      imagefilter: '1',
      limit: '50',
      offset: '0'
    })

    const response = await fetch(
      `https://www.skiddle.com/api/v1/events/search/?${params}`,
      {
        headers: {
          'Accept': 'application/json'
        }
      }
    )

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        console.error('Skiddle API: Invalid API key')
        return res.status(500).json({ error: 'API authentication failed' })
      }
      if (response.status === 429) {
        return res.status(429).json({ error: 'Skiddle rate limit exceeded' })
      }
      throw new Error(`Skiddle API error: ${response.status}`)
    }

    const data = await response.json()

    if (data.error) {
      console.error('Skiddle API error:', data.error)
      return res.status(500).json({ error: 'Skiddle API error' })
    }

    // Set cache headers (5 minutes)
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')

    return res.status(200).json(data)
  } catch (error) {
    console.error('Skiddle proxy error:', error.message)
    return res.status(500).json({ error: 'Failed to fetch events' })
  }
}

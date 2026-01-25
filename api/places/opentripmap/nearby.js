/**
 * OpenTripMap Nearby Places Proxy
 *
 * Securely proxies requests to OpenTripMap API using server-side API key.
 * GET /api/places/opentripmap/nearby?lat=X&lng=Y&radius=Z&kinds=optional
 */

const OTM_API = 'https://api.opentripmap.com/0.1'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.OPENTRIPMAP_KEY
  if (!apiKey) {
    console.error('[OTM Proxy] OPENTRIPMAP_KEY not configured')
    return res.status(503).json({ error: 'OpenTripMap not configured' })
  }

  const { lat, lng, radius = '5000', kinds } = req.query

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' })
  }

  try {
    let url = `${OTM_API}/en/places/radius?lat=${lat}&lon=${lng}&radius=${radius}&limit=100&rate=2&apikey=${apiKey}`

    if (kinds) {
      url += `&kinds=${kinds}`
    }

    const response = await fetch(url)

    if (!response.ok) {
      console.error(`[OTM Proxy] API error: ${response.status}`)
      return res.status(response.status).json({ error: 'OpenTripMap API error' })
    }

    const data = await response.json()

    // Transform to our format
    const places = Array.isArray(data) ? data.map(place => ({
      id: `otm_${place.xid}`,
      xid: place.xid,
      name: place.name,
      lat: place.point?.lat,
      lng: place.point?.lon,
      kinds: place.kinds,
      rating: place.rate,
      source: 'opentripmap'
    })).filter(p => p.name && p.lat && p.lng) : []

    // Cache for 10 minutes
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200')
    return res.status(200).json({ places })

  } catch (error) {
    console.error('[OTM Proxy] Error:', error.message)
    return res.status(500).json({ error: 'Failed to fetch places' })
  }
}

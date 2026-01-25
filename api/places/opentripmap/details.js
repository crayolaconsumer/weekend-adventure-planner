/**
 * OpenTripMap Place Details Proxy
 *
 * Securely proxies requests to OpenTripMap API for place details (includes images).
 * GET /api/places/opentripmap/details?xid=PLACE_XID
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

  const { xid } = req.query

  if (!xid) {
    return res.status(400).json({ error: 'xid is required' })
  }

  try {
    const response = await fetch(
      `${OTM_API}/en/places/xid/${xid}?apikey=${apiKey}`
    )

    if (!response.ok) {
      console.error(`[OTM Proxy] API error: ${response.status}`)
      return res.status(response.status).json({ error: 'OpenTripMap API error' })
    }

    const data = await response.json()

    // Return relevant details including image
    const details = {
      name: data.name,
      description: data.wikipedia_extracts?.text || data.info?.descr || null,
      image: data.preview?.source || data.image || null,
      wikipedia: data.wikipedia || null,
      wikidata: data.wikidata || null,
      address: formatAddress(data.address),
      website: data.url || null,
      kinds: data.kinds,
      rating: data.rate
    }

    // Cache for 30 minutes (details don't change often)
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600')
    return res.status(200).json(details)

  } catch (error) {
    console.error('[OTM Proxy] Error:', error.message)
    return res.status(500).json({ error: 'Failed to fetch details' })
  }
}

function formatAddress(addr) {
  if (!addr) return null
  const parts = [
    addr.house_number,
    addr.road,
    addr.suburb,
    addr.city || addr.town || addr.village,
    addr.postcode
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

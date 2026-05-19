/**
 * OpenTripMap Nearby Places Proxy
 *
 * Securely proxies requests to OpenTripMap API using server-side API key.
 * GET /api/places/opentripmap/nearby?lat=X&lng=Y&radius=Z&kinds=optional
 */

import { applyRateLimit, RATE_LIMITS } from '../../lib/rateLimit.js'
import { withCors } from '../../lib/cors.js'
import { cacheGet, cacheSet, hashKey, isCacheEnabled } from '../../lib/kvCache.js'
import { waitUntil } from '@vercel/functions'

const OTM_API = 'https://api.opentripmap.com/0.1'

const OTM_CACHE_TTL_SECONDS = 24 * 60 * 60

// Rate limit: 60 requests per minute per IP (OTM free tier is 5000/day)
const OTM_RATE_LIMIT = {
  windowMs: 60 * 1000,
  max: 60,
  blockDurationMs: 5 * 60 * 1000 // Block for 5 min if exceeded
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Apply rate limiting
  const rateLimitError = applyRateLimit(req, res, OTM_RATE_LIMIT, 'otm_nearby')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const apiKey = process.env.OPENTRIPMAP_KEY
  if (!apiKey) {
    // OpenTripMap is an OPTIONAL data source. Returning a hard error
    // here makes the entire Discover feed look broken if anyone forgets
    // to set the key (or the key gets revoked, as the OTM service has
    // been winding down operations and silently invalidating keys).
    // The client treats this proxy as best-effort, falling back to
    // Overpass for the bulk of places. Return an empty payload so the
    // client moves on cleanly.
    console.warn('[OTM Proxy] OPENTRIPMAP_KEY not configured — returning empty')
    return res.status(200).json({ places: [], unavailable: true })
  }

  const { lat, lng, radius = '5000', kinds } = req.query

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' })
  }

  // Validate parameters to prevent injection
  const latNum = parseFloat(lat)
  const lngNum = parseFloat(lng)
  const radiusNum = parseInt(radius, 10)

  if (isNaN(latNum) || latNum < -90 || latNum > 90) {
    return res.status(400).json({ error: 'Invalid latitude' })
  }
  if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
    return res.status(400).json({ error: 'Invalid longitude' })
  }
  if (isNaN(radiusNum) || radiusNum < 100 || radiusNum > 50000) {
    return res.status(400).json({ error: 'Invalid radius (100-50000m)' })
  }

  // KV cache check before hitting upstream. Key on the public params
  // (lat/lng/radius/kinds) not the URL — the API key must never appear
  // in a cache identifier, and the URL changes whenever we rotate keys.
  const cacheKey = `otm:nearby:${hashKey(`${latNum.toFixed(4)}|${lngNum.toFixed(4)}|${radiusNum}|${kinds || ''}`)}`
  if (isCacheEnabled()) {
    const cached = await cacheGet(cacheKey)
    if (cached) {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800')
      res.setHeader('X-OTM-Cache', 'HIT')
      return res.status(200).json(cached)
    }
  }

  try {
    let url = `${OTM_API}/en/places/radius?lat=${latNum}&lon=${lngNum}&radius=${radiusNum}&limit=100&rate=2&apikey=${apiKey}`

    // Sanitize kinds parameter (only allow alphanumeric and underscores)
    if (kinds && /^[a-zA-Z0-9_,]+$/.test(kinds)) {
      url += `&kinds=${kinds}`
    }

    const response = await fetch(url)

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      console.error(`[OTM Proxy] API error: ${response.status} - ${errorText}`)

      // 401 = key invalid/revoked. OTM has been silently revoking keys
      // for months as they wind down the service. Don't kill the feed
      // for the user — return empty so the client falls back to
      // Overpass. Same treatment for any non-2xx now: OTM is treated as
      // best-effort, never load-bearing.
      if (response.status === 401 || response.status === 403) {
        return res.status(200).json({ places: [], unavailable: true, reason: 'auth' })
      }
      if (response.status === 429) {
        return res.status(200).json({ places: [], unavailable: true, reason: 'rate-limited' })
      }
      // 5xx and others — still degrade gracefully rather than 500-ing
      // the user's discover feed.
      return res.status(200).json({ places: [], unavailable: true, reason: 'upstream-error' })
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

    const payload = { places }

    // Persist to KV (fire-and-forget) and to CDN edge cache. OTM/POI
    // data changes at the day scale at fastest, so 24h is the right
    // tradeoff between freshness and protecting us from key revocation.
    if (isCacheEnabled()) {
      waitUntil(cacheSet(cacheKey, payload, OTM_CACHE_TTL_SECONDS).catch(() => {}))
    }

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800')
    res.setHeader('X-OTM-Cache', isCacheEnabled() ? 'MISS' : 'BYPASS')
    return res.status(200).json(payload)

  } catch (error) {
    // Network errors talking to OTM (DNS, timeout, etc) — degrade
    // gracefully so the client falls back to Overpass instead of
    // breaking the Discover feed.
    console.error('[OTM Proxy] Error:', error.message)
    return res.status(200).json({ places: [], unavailable: true, reason: 'network-error' })
  }
}

export default withCors(handler)

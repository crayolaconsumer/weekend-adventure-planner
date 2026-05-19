/**
 * OpenTripMap Place Details Proxy
 *
 * Securely proxies requests to OpenTripMap API for place details (includes images).
 * GET /api/places/opentripmap/details?xid=PLACE_XID
 */

import { applyRateLimit } from '../../lib/rateLimit.js'
import { withCors } from '../../lib/cors.js'
import { cacheGet, cacheSet, isCacheEnabled } from '../../lib/kvCache.js'
import { waitUntil } from '@vercel/functions'

const OTM_API = 'https://api.opentripmap.com/0.1'

// Place details barely change — a 7-day TTL is fine and reduces the
// number of upstream details calls dramatically (every Place card the
// user opens currently hits this endpoint, which fans out hard on a
// busy session).
const OTM_DETAILS_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60

// Rate limit: 120 requests per minute per IP (details are smaller requests)
const OTM_DETAILS_RATE_LIMIT = {
  windowMs: 60 * 1000,
  max: 120,
  blockDurationMs: 5 * 60 * 1000 // Block for 5 min if exceeded
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Apply rate limiting
  const rateLimitError = applyRateLimit(req, res, OTM_DETAILS_RATE_LIMIT, 'otm_details')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const apiKey = process.env.OPENTRIPMAP_KEY
  if (!apiKey) {
    console.warn('[OTM Proxy] OPENTRIPMAP_KEY not configured — returning empty details')
    return res.status(200).json({ unavailable: true, reason: 'not-configured' })
  }

  const { xid } = req.query

  if (!xid) {
    return res.status(400).json({ error: 'xid is required' })
  }

  // Validate xid format (alphanumeric, underscores, colons - typical OTM format)
  if (!/^[a-zA-Z0-9_:]+$/.test(xid) || xid.length > 50) {
    return res.status(400).json({ error: 'Invalid xid format' })
  }

  // KV cache. xid is already short + alphanumeric so it's a safe direct
  // key — no need to hash. Keyed without the API key (which is in the
  // upstream URL, not the cache identifier).
  const cacheKey = `otm:details:${xid}`
  if (isCacheEnabled()) {
    const cached = await cacheGet(cacheKey)
    if (cached) {
      res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=1209600')
      res.setHeader('X-OTM-Cache', 'HIT')
      return res.status(200).json(cached)
    }
  }

  try {
    const response = await fetch(
      `${OTM_API}/en/places/xid/${encodeURIComponent(xid)}?apikey=${apiKey}`
    )

    if (!response.ok) {
      console.error(`[OTM Proxy] API error: ${response.status}`)
      if (response.status === 401 || response.status === 403) {
        return res.status(200).json({ unavailable: true, reason: 'auth' })
      }
      if (response.status === 429) {
        return res.status(200).json({ unavailable: true, reason: 'rate-limited' })
      }
      return res.status(200).json({ unavailable: true, reason: 'upstream-error' })
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

    if (isCacheEnabled()) {
      waitUntil(cacheSet(cacheKey, details, OTM_DETAILS_CACHE_TTL_SECONDS).catch(() => {}))
    }

    res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=1209600')
    res.setHeader('X-OTM-Cache', isCacheEnabled() ? 'MISS' : 'BYPASS')
    return res.status(200).json(details)

  } catch (error) {
    console.error('[OTM Proxy] Error:', error.message)
    return res.status(200).json({ unavailable: true, reason: 'network-error' })
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

export default withCors(handler)

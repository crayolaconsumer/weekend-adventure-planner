/**
 * GET /api/places/image-resolve?wikipedia=&wikidata=&lat=&lng=
 *
 * Multi-source image resolver for places. Tries up to three free upstream
 * providers in parallel and returns the first hit (in preference order).
 * All upstream calls run server-side so the cache is shared across the
 * whole user base — N users opening the same place → 1 set of upstream
 * fetches per day, not N.
 *
 * Sources, in preference order when multiple hit:
 *   1. Wikipedia summary thumbnail (via the wikipedia tag)
 *   2. Wikidata P18 image (via the wikidata QID, points to a Commons file)
 *   3. Wikimedia Commons geosearch — finds any geotagged image within
 *      300m of (lat, lng). The killer source for outdoor / nature places
 *      that aren't in Wikipedia individually but are photographed by
 *      Commons contributors.
 *
 * Cached aggressively at the Vercel edge (1 day s-maxage, 1 week SWR).
 * Function-instance memory cache for hot paths within a single warm
 * function. Per-IP rate limited.
 *
 * Response shape (always 200 even when no image is found, so frontend
 * can cache "no image available" without polling):
 *   {
 *     url: string | null,
 *     source: 'wikipedia' | 'wikidata' | 'commons-geo' | null,
 *     attribution: { name, url, source } | null
 *   }
 */

import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

const MEMORY_TTL_MS = 60 * 60 * 1000
const memCache = new Map()

const POLITE_HEADERS = {
  'User-Agent': 'ROAM/1.0 (https://go-roam.uk; support@extrastaff.com)',
  'Accept': 'application/json'
}

// Upstream calls get a bounded timeout so a slow source doesn't hold up
// the whole resolver. Each source runs in parallel; whoever finishes
// first with a hit dictates response latency.
const UPSTREAM_TIMEOUT_MS = 4000

function cacheKey({ wikipedia, wikidata, lat, lng }) {
  // Round coords to 4 decimals (~11m) so nearby calls hit the same cache.
  // Anything tighter just causes cache fragmentation without a meaningful
  // change in geosearch results.
  const roundedLat = lat == null ? '' : (Math.round(lat * 10000) / 10000).toFixed(4)
  const roundedLng = lng == null ? '' : (Math.round(lng * 10000) / 10000).toFixed(4)
  return `wp:${wikipedia || ''}|wd:${wikidata || ''}|geo:${roundedLat},${roundedLng}`
}

async function fetchWithTimeout(url, options = {}, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function tryWikipedia(tag) {
  if (!tag || typeof tag !== 'string') return null
  const colonIdx = tag.indexOf(':')
  const lang = colonIdx > 0 ? tag.slice(0, colonIdx).toLowerCase() : 'en'
  const title = colonIdx > 0 ? tag.slice(colonIdx + 1) : tag
  if (!title) return null
  try {
    const res = await fetchWithTimeout(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: POLITE_HEADERS }
    )
    if (!res.ok) return null
    const data = await res.json()
    const url = data?.thumbnail?.source || data?.originalimage?.source || null
    if (!url) return null
    return {
      url,
      source: 'wikipedia',
      attribution: {
        name: typeof data.title === 'string' ? data.title : title,
        url: data?.content_urls?.desktop?.page || null,
        source: 'Wikipedia'
      }
    }
  } catch { return null }
}

async function tryWikidata(qid) {
  if (!qid || typeof qid !== 'string') return null
  // Reject anything that doesn't look like a QID — guard against query injection
  if (!/^Q\d+$/.test(qid)) return null
  try {
    const res = await fetchWithTimeout(
      `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`,
      { headers: POLITE_HEADERS }
    )
    if (!res.ok) return null
    const data = await res.json()
    const claims = data?.entities?.[qid]?.claims?.P18
    const filename = claims?.[0]?.mainsnak?.datavalue?.value
    if (!filename || typeof filename !== 'string') return null
    return {
      url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=800`,
      source: 'wikidata',
      attribution: {
        name: filename,
        url: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(filename)}`,
        source: 'Wikimedia Commons'
      }
    }
  } catch { return null }
}

async function tryCommonsGeo(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  try {
    // gsradius=300 (metres) — small enough that a hit is likely the same place,
    // big enough to actually find something for places photographed nearby.
    // gsnamespace=6 = file pages only.
    const url = `https://commons.wikimedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lng}&gsradius=300&gsnamespace=6&gslimit=5&format=json&origin=*`
    const res = await fetchWithTimeout(url, { headers: POLITE_HEADERS })
    if (!res.ok) return null
    const data = await res.json()
    const items = data?.query?.geosearch || []
    const first = items[0]
    if (!first?.title) return null
    // Strip the File: prefix to get the bare filename
    const filename = first.title.replace(/^File:/, '')
    return {
      url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=800`,
      source: 'commons-geo',
      attribution: {
        name: filename,
        url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(first.title)}`,
        source: 'Wikimedia Commons'
      }
    }
  } catch { return null }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'places:image-resolve')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const wikipedia = req.query.wikipedia && typeof req.query.wikipedia === 'string' ? req.query.wikipedia.slice(0, 200) : null
  const wikidata = req.query.wikidata && typeof req.query.wikidata === 'string' ? req.query.wikidata.slice(0, 30) : null
  const latRaw = req.query.lat
  const lngRaw = req.query.lng
  const lat = latRaw != null && latRaw !== '' ? parseFloat(latRaw) : null
  const lng = lngRaw != null && lngRaw !== '' ? parseFloat(lngRaw) : null
  const validCoords = typeof lat === 'number' && !Number.isNaN(lat) && typeof lng === 'number' && !Number.isNaN(lng)

  if (!wikipedia && !wikidata && !validCoords) {
    return res.status(400).json({ error: 'wikipedia, wikidata, or lat+lng required' })
  }

  const key = cacheKey({ wikipedia, wikidata, lat: validCoords ? lat : null, lng: validCoords ? lng : null })

  const memHit = memCache.get(key)
  if (memHit && Date.now() - memHit.ts < MEMORY_TTL_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
    res.setHeader('X-Roam-Cache', 'function')
    return res.status(200).json(memHit.value)
  }

  // All three sources race in parallel — first hit wins by preference order.
  // No source blocks any other; total latency = max(slow_one) up to UPSTREAM_TIMEOUT_MS.
  const [wp, wd, geo] = await Promise.all([
    tryWikipedia(wikipedia),
    tryWikidata(wikidata),
    validCoords ? tryCommonsGeo(lat, lng) : Promise.resolve(null)
  ])

  const value = wp || wd || geo || { url: null, source: null, attribution: null }

  memCache.set(key, { value, ts: Date.now() })
  // Bound the memCache size so a long-running function instance doesn't
  // grow without limit. Drop the oldest 100 entries when we cross 500.
  if (memCache.size > 500) {
    const drop = Array.from(memCache.keys()).slice(0, 100)
    for (const k of drop) memCache.delete(k)
  }

  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
  res.setHeader('X-Roam-Cache', value.url ? 'fresh-hit' : 'fresh-miss')
  return res.status(200).json(value)
}

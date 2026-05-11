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
import { withCors } from '../lib/cors.js'

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

// Bump v when behaviour changes so existing memory/edge caches don't
// keep serving the old verdict. v2 = dropped Commons geosearch.
const CACHE_VERSION = 'v2'

function cacheKey({ wikipedia, wikidata, commons, website, lat, lng }) {
  // Round coords to 4 decimals (~11m) so nearby calls hit the same cache.
  // Anything tighter just causes cache fragmentation without a meaningful
  // change in geosearch results.
  const roundedLat = lat == null ? '' : (Math.round(lat * 10000) / 10000).toFixed(4)
  const roundedLng = lng == null ? '' : (Math.round(lng * 10000) / 10000).toFixed(4)
  // The website key is hashed to a fixed-width string — full URLs would
  // make cache keys unbounded and degrade lookup perf.
  let websiteKey = ''
  if (website) {
    try {
      websiteKey = new URL(website.startsWith('http') ? website : `https://${website}`).hostname
    } catch { websiteKey = '' }
  }
  return `${CACHE_VERSION}:wp:${wikipedia || ''}|wd:${wikidata || ''}|cm:${commons || ''}|web:${websiteKey}|geo:${roundedLat},${roundedLng}`
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

/**
 * Specific Wikimedia Commons file declared by an OSM mapper via the
 * `wikimedia_commons=File:Foo.jpg` tag. Unlike tryCommonsGeo (which
 * we removed because its results are tagged by photo LOCATION, not
 * SUBJECT), this is a mapper-vetted "this file is of this place".
 * High relevance, low coverage.
 */
async function tryCommonsFile(commonsTag) {
  if (!commonsTag || typeof commonsTag !== 'string') return null
  // Strip "File:" if the mapper included it, then re-add for the URL.
  // Reject anything looking like a path-traversal attempt.
  const bare = commonsTag.replace(/^File:/i, '').trim()
  if (!bare || /[\\/]/.test(bare) || bare.length > 250) return null
  return {
    url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(bare)}?width=800`,
    source: 'commons-osm',
    attribution: {
      name: bare,
      url: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(bare)}`,
      source: 'Wikimedia Commons (OSM tag)'
    }
  }
}

/**
 * Fetch the venue's website and extract its og:image (the social-share
 * preview image). Nearly every modern site sets one, and for a venue
 * site it's almost always a photo of the venue, the food, or the
 * brand. Massively under-used as a source.
 *
 * Risks managed:
 *   - Some sites 403 / CSP-block bots → bounded timeout, swallow errors
 *   - Pages can be huge — only read the head (<= 64 KB) since og:image
 *     lives in <head>
 *   - Resolve relative-URL og:image values against the page origin
 *   - Reject non-https URLs (mixed content would be blocked on iOS anyway)
 */
async function tryWebsiteOgImage(website) {
  if (!website || typeof website !== 'string') return null
  let pageUrl
  try {
    pageUrl = new URL(website.startsWith('http') ? website : `https://${website}`)
  } catch { return null }
  if (pageUrl.protocol !== 'https:' && pageUrl.protocol !== 'http:') return null

  try {
    const res = await fetchWithTimeout(pageUrl.toString(), {
      headers: {
        ...POLITE_HEADERS,
        // Most CSPs whitelist normal browsers; mimic so we get HTML
        // instead of being shown an API-only stub.
        'Accept': 'text/html,application/xhtml+xml',
        // Some sites gate on UA. We're an honest crawler — keep our
        // brand UA but make sure the page knows we want HTML.
      }
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') || ''
    if (!/text\/html|application\/xhtml/i.test(ct)) return null

    // Stream-read up to 64 KB then bail — og tags live in the <head>.
    // If the head is genuinely larger than this we don't want the image
    // badly enough to download a megabyte of body.
    const reader = res.body?.getReader()
    if (!reader) return null
    let html = ''
    let received = 0
    const decoder = new TextDecoder('utf-8', { fatal: false })
    while (received < 64 * 1024) {
      const { value, done } = await reader.read()
      if (done) break
      html += decoder.decode(value, { stream: true })
      received += value.byteLength
      if (/<\/head>/i.test(html)) break
    }
    try { reader.cancel() } catch { /* noop */ }

    // Try og:image first (Facebook convention), then twitter:image
    // (some sites only set this), then itemprop=image.
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i)
    const tw = html.match(/<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i)
    const raw = og?.[1] || tw?.[1]
    if (!raw) return null

    // Resolve relative URLs against the page origin
    let imgUrl
    try {
      imgUrl = new URL(raw, pageUrl).toString()
    } catch { return null }

    // Reject data: URLs (could be SVG with script) and require https for iOS WKWebView
    if (!/^https:/i.test(imgUrl)) return null

    return {
      url: imgUrl,
      source: 'website-og',
      attribution: {
        name: pageUrl.hostname,
        url: pageUrl.toString(),
        source: pageUrl.hostname
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

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'places:image-resolve')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const wikipedia = req.query.wikipedia && typeof req.query.wikipedia === 'string' ? req.query.wikipedia.slice(0, 200) : null
  const wikidata = req.query.wikidata && typeof req.query.wikidata === 'string' ? req.query.wikidata.slice(0, 30) : null
  const commons = req.query.commons && typeof req.query.commons === 'string' ? req.query.commons.slice(0, 250) : null
  const website = req.query.website && typeof req.query.website === 'string' ? req.query.website.slice(0, 500) : null
  const latRaw = req.query.lat
  const lngRaw = req.query.lng
  const lat = latRaw != null && latRaw !== '' ? parseFloat(latRaw) : null
  const lng = lngRaw != null && lngRaw !== '' ? parseFloat(lngRaw) : null
  const validCoords = typeof lat === 'number' && !Number.isNaN(lat) && typeof lng === 'number' && !Number.isNaN(lng)

  if (!wikipedia && !wikidata && !commons && !website && !validCoords) {
    return res.status(400).json({ error: 'wikipedia, wikidata, commons, website, or lat+lng required' })
  }

  const key = cacheKey({
    wikipedia,
    wikidata,
    commons,
    website,
    lat: validCoords ? lat : null,
    lng: validCoords ? lng : null
  })

  const memHit = memCache.get(key)
  if (memHit && Date.now() - memHit.ts < MEMORY_TTL_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
    res.setHeader('X-Roam-Cache', 'function')
    return res.status(200).json(memHit.value)
  }

  // Resolution chain in preference order:
  //   1. OSM `wikimedia_commons` tag — mapper-vetted specific Commons file
  //   2. Wikipedia summary thumbnail (via wikipedia tag)
  //   3. Wikidata P18 (via wikidata QID, points to a Commons file)
  //   4. Venue website og:image — the venue's own self-selected photo,
  //      huge untapped source for restaurants/cafes/shops that don't
  //      have a Wikipedia article but DO have a website. Slowest of the
  //      four (HTML fetch + parse) so it runs in parallel with the others.
  //
  // Commons geosearch (was tier 3) is intentionally NOT in the race —
  // its results are tagged by photo LOCATION, not SUBJECT, so they
  // returned random nearby street scenes. tryCommonsGeo() kept in the
  // file as dead code in case a future filter makes it safe to re-enable.
  // Reference tryCommonsGeo so the dead-code preserved-for-future tier
  // doesn't become an unused-function lint warning. Self-documenting.
  void tryCommonsGeo
  const [cm, wp, wd, og] = await Promise.all([
    tryCommonsFile(commons),
    tryWikipedia(wikipedia),
    tryWikidata(wikidata),
    tryWebsiteOgImage(website)
  ])

  // Preference order: mapper-declared Commons file → Wikipedia → Wikidata → website og.
  // Wikipedia ranks above the website og because for landmarks (museum,
  // castle, park) the Wikipedia thumb is curated; the venue website
  // tier shines for unnamed restaurants/cafes/shops which wouldn't
  // have wp/wd anyway.
  const value = cm || wp || wd || og || { url: null, source: null, attribution: null }

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

export default withCors(handler)

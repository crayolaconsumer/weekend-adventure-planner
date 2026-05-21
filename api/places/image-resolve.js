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
// keep serving the old verdict.
//   v2 = dropped Commons geosearch.
//   v3 = added category-gated geosearch + Commons name-search + venue
//        website og:image, reshuffled preference order by category.
//   v4 = removed Commons name-search from food/nightlife/shopping +
//        added title-keyword denylist filter (war / military / weapon
//        imagery was being returned for cuisine names like "Afghan",
//        "Syrian", "Vietnamese"). Old caches must be invalidated.
const CACHE_VERSION = 'v4'

// Wikimedia Commons file titles that contain any of these tokens are
// rejected outright, regardless of source tier. The denylist covers
// war / military / weapons / casualty imagery that's heavily over-
// represented in Commons for country-name searches. Conservative —
// false-positives just mean "no image" which is the safe failure mode.
const COMMONS_TITLE_DENYLIST = [
  'army', 'military', 'soldier', 'troop', 'troops', 'marine', 'marines',
  'navy', 'air_force', 'airforce', 'combat', 'war', 'wartime', 'wounded',
  'casualt', 'injur', 'medevac', 'medic_treat', 'medical_treatment',
  'evacuation', 'patrol', 'humvee', 'tank', 'mortar', 'rifle', 'weapon',
  'corpsman', 'platoon', 'battalion', 'regiment', 'infantry', 'sniper',
  'enduring_freedom', 'iraqi_freedom', 'gulf_war', 'afghan_war'
]

function isDenylistedTitle(title) {
  if (!title || typeof title !== 'string') return false
  const normalised = title.toLowerCase().replace(/[\s-]+/g, '_')
  return COMMONS_TITLE_DENYLIST.some(token => normalised.includes(token))
}

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

/**
 * Categories where Commons geosearch reliably returns relevant photos.
 * Outdoor landmarks tend to be photographed BY name (a Commons file
 * geotagged near a castle is usually a photo of the castle); private
 * venues (restaurants, shops, pubs) get random street-scene noise
 * because they're in built-up areas with unrelated geotagged content.
 */
const GEOSEARCH_OK_CATEGORIES = new Set([
  'nature',
  'historic',
  'culture',
  'entertainment',
  'active'
])

/**
 * Drop result titles that look like generic street/road/building shots —
 * these are the false-positives that prompted the "absolute garbage"
 * complaint. Title text in Commons follows the filename convention so
 * keyword matching is reliable.
 */
const GEOSEARCH_TITLE_DENYLIST = /\b(road|street|junction|roundabout|crossing|footpath|pavement|sidewalk|signpost|sign\b|highway|motorway|verge|bus stop|car park|carpark)\b/i

async function tryCommonsGeo(lat, lng, category) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  // Category gate — running geosearch for restaurants/shops produced
  // unrelated nearby street scenes. Only allow outdoor / landmark
  // categories where geotagged Commons photos are usually OF the place.
  if (!GEOSEARCH_OK_CATEGORIES.has(category)) return null
  try {
    // gsradius=120m — tighter than the original 300m so we're really
    // "on top of" the feature. Anything farther is too likely to be of
    // something else nearby (especially in cities).
    const url = `https://commons.wikimedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lng}&gsradius=120&gsnamespace=6&gslimit=10&format=json&origin=*`
    const res = await fetchWithTimeout(url, { headers: POLITE_HEADERS })
    if (!res.ok) return null
    const data = await res.json()
    const items = data?.query?.geosearch || []
    // Filter results by title — skip obvious "road sign at corner of X"
    // type photos that aren't of any named feature, AND skip anything
    // matching the global denylist (war / military / weapon imagery).
    const filtered = items.filter(it =>
      it?.title &&
      !GEOSEARCH_TITLE_DENYLIST.test(it.title) &&
      !isDenylistedTitle(it.title)
    )
    const first = filtered[0]
    if (!first?.title) return null
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

/**
 * Find a Commons file whose title contains the place's name. Higher
 * signal than geosearch because the title is metadata describing the
 * subject, not just the location the camera was at. Hit rate is low
 * (only named landmarks get individual Commons files) but when it
 * hits, the file is reliably of the place.
 */
async function tryCommonsNameSearch(name) {
  if (!name || typeof name !== 'string') return null
  const trimmed = name.trim()
  if (trimmed.length < 4) return null // too short to be specific
  try {
    // srsearch with srnamespace=6 (file pages), prefer recent + relevant
    const url = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`intitle:"${trimmed}"`)}&srnamespace=6&srlimit=5&format=json&origin=*`
    const res = await fetchWithTimeout(url, { headers: POLITE_HEADERS })
    if (!res.ok) return null
    const data = await res.json()
    const items = data?.query?.search || []
    // intitle: search already requires the name to be in the title.
    // Pick the first file with a recognisable image extension that
    // ALSO passes the denylist — Commons has a lot of war / military
    // imagery tagged with country / cuisine names that share titles
    // with restaurant names (Afghan, Syrian, Vietnamese, etc.).
    const first = items.find(it =>
      it?.title &&
      /\.(jpe?g|png|webp|gif)$/i.test(it.title) &&
      !isDenylistedTitle(it.title)
    )
    if (!first?.title) return null
    const filename = first.title.replace(/^File:/, '')
    return {
      url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=800`,
      source: 'commons-name',
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
  // name + category drive the new name-search + category-gated geo tiers.
  // Limit name length to stop pathological queries; category to known keys.
  const name = req.query.name && typeof req.query.name === 'string' ? req.query.name.slice(0, 120) : null
  const categoryRaw = req.query.category && typeof req.query.category === 'string' ? req.query.category.toLowerCase().slice(0, 20) : null
  const category = categoryRaw && /^[a-z]+$/.test(categoryRaw) ? categoryRaw : null
  const latRaw = req.query.lat
  const lngRaw = req.query.lng
  const lat = latRaw != null && latRaw !== '' ? parseFloat(latRaw) : null
  const lng = lngRaw != null && lngRaw !== '' ? parseFloat(lngRaw) : null
  const validCoords = typeof lat === 'number' && !Number.isNaN(lat) && typeof lng === 'number' && !Number.isNaN(lng)

  if (!wikipedia && !wikidata && !commons && !website && !name && !validCoords) {
    return res.status(400).json({ error: 'wikipedia, wikidata, commons, website, name, or lat+lng required' })
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

  // ─── Six-source parallel race ─────────────────────────────────
  // Run every reasonable image source in parallel. Each returns either
  // a hit ({ url, source, attribution }) or null. We then pick by
  // category-aware preference order — restaurants want venue-website
  // og:image first, landmarks want Wikipedia first, etc.
  //
  // All sources are bounded by UPSTREAM_TIMEOUT_MS so a slow tier
  // doesn't gate response latency. Edge cache + memory cache hides
  // the cost on the second hit.
  const [cm, wp, wd, og, geo, cn] = await Promise.all([
    tryCommonsFile(commons),
    tryWikipedia(wikipedia),
    tryWikidata(wikidata),
    tryWebsiteOgImage(website),
    validCoords ? tryCommonsGeo(lat, lng, category) : Promise.resolve(null),
    tryCommonsNameSearch(name)
  ])

  // ─── Pick the best result ─────────────────────────────────────
  // Different categories want different sources:
  //   - Landmarks (historic, culture, nature, entertainment, active):
  //     curated databases (Wikipedia / Wikidata / Commons by name)
  //     beat venue website, which is often a homepage banner rather
  //     than a photo of the venue.
  //   - Venues (food, nightlife, shopping, unique): the venue's own
  //     website OG image is usually the best photo because the venue
  //     picks it deliberately. Wikipedia rarely has a restaurant.
  //
  //     Commons name-search is DELIBERATELY EXCLUDED for venue
  //     categories: searching "Afghan" / "Syrian" / "Vietnamese" etc.
  //     on Commons returns a flood of war / military photography that
  //     surfaces as the hero image for cuisine restaurants. The denylist
  //     filter in tryCommonsNameSearch catches most of it, but the
  //     correct fix for venues is "don't use name search at all —
  //     restaurants don't have Commons files of themselves." For
  //     landmarks (Stonehenge, Westminster Abbey) the same search
  //     usefully returns the named place's photo, so keep it there.
  //
  // Mapper-vetted sources (cm = OSM-declared Commons file) always
  // come first in both orders — they're the highest-curated signal.
  const isLandmarkLike = category === 'historic' || category === 'culture' ||
                         category === 'nature' || category === 'entertainment' ||
                         category === 'active'

  const value = isLandmarkLike
    ? (cm || wp || wd || cn || geo || og || { url: null, source: null, attribution: null })
    : (cm || og || wp || wd || geo || { url: null, source: null, attribution: null })

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

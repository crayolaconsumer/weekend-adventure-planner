/**
 * Place image resolver
 *
 * One source of truth for "what image should we show for this place?"
 *
 * Resolution chain:
 *   1. Real image present in the place data (place.image / .imageUrl / .photo /
 *      .placeData.image / etc.) — use it directly.
 *   2. Wikipedia thumbnail via place.tags.wikipedia or .wikipedia — fetched
 *      asynchronously, cached in localStorage.
 *   3. null — caller renders a <PlaceImagePlaceholder /> instead. We
 *      deliberately do NOT fall back to iconic stock landmark photos
 *      (Taj Mahal, Statue of Liberty, etc.) because they create false
 *      expectations and damage trust when the place is something
 *      different.
 *
 * Sync vs async:
 *   - resolvePlaceImageSync returns whatever we know right now (without
 *     any network I/O). Used for first paint.
 *   - resolvePlaceImageAsync may issue a Wikipedia request to upgrade
 *     a sync miss. Cached in localStorage with a TTL.
 */

// v3 = added 4 new tiers + smart per-category preference. Bumping the
// key force-clears any localStorage entries cached with the v2 verdict
// (which often returned null because geosearch was disabled outright),
// so users see the upgraded results on next page load.
const WIKI_CACHE_KEY = 'roam_wiki_image_cache_v3'
const WIKI_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

const memoryCache = new Map() // wiki key -> url | null

function loadDiskCache() {
  try {
    const raw = localStorage.getItem(WIKI_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveDiskEntry(key, value) {
  try {
    const cache = loadDiskCache()
    cache[key] = { value, ts: Date.now() }
    // Trim to max 200 entries to bound localStorage growth
    const entries = Object.entries(cache)
    if (entries.length > 200) {
      const trimmed = entries
        .sort((a, b) => (b[1]?.ts ?? 0) - (a[1]?.ts ?? 0))
        .slice(0, 200)
      localStorage.setItem(WIKI_CACHE_KEY, JSON.stringify(Object.fromEntries(trimmed)))
    } else {
      localStorage.setItem(WIKI_CACHE_KEY, JSON.stringify(cache))
    }
  } catch {
    // Disk cache best-effort
  }
}

function readDiskEntry(key) {
  const cache = loadDiskCache()
  const entry = cache[key]
  if (!entry) return undefined
  if (Date.now() - (entry.ts ?? 0) > WIKI_CACHE_TTL_MS) return undefined
  return entry.value
}

/**
 * Pick the first defined string-ish field from a nested structure.
 */
function pickFirstUrl(...candidates) {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim()
    if (c && typeof c === 'object') {
      const fromObj = c.url || c.source || c.src
      if (typeof fromObj === 'string' && fromObj.trim().length > 0) return fromObj.trim()
    }
  }
  return null
}

/**
 * Returns the best-known image URL for a place WITHOUT any network I/O.
 * Returns null if we'd have to ask Wikipedia (caller can show a
 * placeholder while they upgrade asynchronously) — never returns a
 * misleading category-stock landmark.
 */
export function resolvePlaceImageSync(place) {
  if (!place || typeof place !== 'object') return null
  const data = place.placeData || place
  return pickFirstUrl(
    data.image,
    data.imageUrl,
    data.photo,
    data.thumbnail,
    data.images?.[0]
  )
}

// Tag parsing now lives server-side in api/wikipedia/summary.js since
// the client only forwards the raw OSM-shaped tag to the proxy.

/**
 * Fetch the full Wikipedia summary for a place's wikipedia tag.
 * Returns { thumbnail, extract, title, contentUrl } or null.
 *
 * One API call gives us both the thumbnail (used by PlaceImage) and
 * the extract (used by PlaceDetail "About" section), so we cache the
 * full object once.
 */
export async function fetchWikipediaSummary(wikipediaTag) {
  const memHit = memoryCache.get(wikipediaTag)
  if (memHit !== undefined) return memHit

  const diskHit = readDiskEntry(wikipediaTag)
  if (diskHit !== undefined) {
    memoryCache.set(wikipediaTag, diskHit)
    return diskHit
  }

  // Hit our server-side proxy, NOT Wikipedia directly. The proxy:
  //   - shares one cache across all users (Vercel edge, 1-day s-maxage)
  //   - rate-limits per IP so a misbehaving client can't blow our quota
  //   - sends a polite User-Agent identifying us per Wikipedia's policy
  // Net effect: from "every user fetches Wikipedia for every place they
  // open" to "one Wikipedia fetch per place per day across all users."
  const url = `/api/wikipedia/summary?tag=${encodeURIComponent(wikipediaTag)}`
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) {
      memoryCache.set(wikipediaTag, null)
      // Don't disk-cache transient failures; an hour from now the proxy may be back
      return null
    }
    const result = await res.json()
    if (!result || (typeof result.thumbnail !== 'string' && typeof result.extract !== 'string' && result.thumbnail !== null)) {
      memoryCache.set(wikipediaTag, null)
      saveDiskEntry(wikipediaTag, null)
      return null
    }
    memoryCache.set(wikipediaTag, result)
    saveDiskEntry(wikipediaTag, result)
    return result
  } catch {
    memoryCache.set(wikipediaTag, null)
    return null
  }
}

/**
 * Resolve a place image via the multi-source server proxy. Tries:
 *   1. Wikipedia (via wikipedia tag)
 *   2. Wikidata P18 (via wikidata QID)
 *   3. OSM `wikimedia_commons` tag — mapper-declared Commons file.
 *   4. Venue website og:image — the place's own social-share photo.
 *      Biggest hit-rate win for restaurants/cafes/shops that aren't
 *      in Wikipedia but DO have a website.
 * Server runs all four in parallel and returns the first hit; caches
 * aggressively at the edge.
 */
async function fetchEnhancedImage(place) {
  const data = place?.placeData || place || {}
  const wiki = data.wikipedia || data.tags?.wikipedia || null
  const wikidata = data.wikidata || data.tags?.wikidata || null
  const commons = data.wikimedia_commons || data.tags?.wikimedia_commons || null
  const website = data.website || data.tags?.website || data.tags?.['contact:website'] || null
  // Name + category power the new Commons-by-name search and the
  // category-gated geosearch tier. Category can live on the place object
  // as either a string (key) or an object ({ key, label }).
  const name = typeof data.name === 'string' ? data.name : null
  const rawCategory = data.category ?? place?.category
  const category = typeof rawCategory === 'string'
    ? rawCategory
    : (rawCategory && typeof rawCategory === 'object' ? rawCategory.key : null)
  const lat = typeof data.lat === 'number' ? data.lat : null
  const lng = typeof data.lng === 'number' ? data.lng :
              typeof data.lon === 'number' ? data.lon : null

  if (!wiki && !wikidata && !commons && !website && !name && (lat == null || lng == null)) return null

  // Build a stable cache key for the disk/memory caches.
  // The website value is condensed to its hostname so the key stays bounded.
  let websiteHost = ''
  if (website) {
    try {
      websiteHost = new URL(website.startsWith('http') ? website : `https://${website}`).hostname
    } catch { websiteHost = '' }
  }
  const key = `image-resolve:v3:${wiki || ''}|${wikidata || ''}|${commons || ''}|${websiteHost}|${name || ''}|${category || ''}|${lat ?? ''},${lng ?? ''}`
  const memHit = memoryCache.get(key)
  if (memHit !== undefined) return memHit
  const diskHit = readDiskEntry(key)
  if (diskHit !== undefined) {
    memoryCache.set(key, diskHit)
    return diskHit
  }

  const params = new URLSearchParams()
  if (wiki) params.set('wikipedia', wiki)
  if (wikidata) params.set('wikidata', wikidata)
  if (commons) params.set('commons', commons)
  if (website) params.set('website', website)
  if (name) params.set('name', name)
  if (category) params.set('category', category)
  if (lat != null) params.set('lat', String(lat))
  if (lng != null) params.set('lng', String(lng))

  try {
    const res = await fetch(`/api/places/image-resolve?${params.toString()}`)
    if (!res.ok) {
      memoryCache.set(key, null)
      return null
    }
    const result = await res.json()
    const url = result?.url || null
    memoryCache.set(key, url)
    // Disk-cache hits and 'no image' verdicts both — saves the round trip
    // either way next time
    saveDiskEntry(key, url)
    return url
  } catch {
    memoryCache.set(key, null)
    return null
  }
}

/**
 * Last-resort stock photos keyed by category. Used only when the
 * multi-source resolver returns null — sparse OSM nodes (e.g., a node
 * tagged `leisure=garden` with no website/wikipedia/wikidata/commons)
 * have no real image source available, and an empty gradient card looks
 * broken. Stock photos give every card a sense of place even when we
 * can't find a photo of THAT specific spot.
 *
 * All images are royalty-free from Unsplash. Two per category so cards
 * in the same swipe don't all look identical.
 */
const CATEGORY_STOCK = {
  food:          ['https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80',
                  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&q=80'],
  nature:        ['https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&q=80',
                  'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=800&q=80'],
  culture:       ['https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=800&q=80',
                  'https://images.unsplash.com/photo-1499426600726-a950358acf16?w=800&q=80'],
  historic:      ['https://images.unsplash.com/photo-1543349689-9a4d426bee8e?w=800&q=80',
                  'https://images.unsplash.com/photo-1564507592333-c60657eea523?w=800&q=80'],
  entertainment: ['https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?w=800&q=80',
                  'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=800&q=80'],
  nightlife:     ['https://images.unsplash.com/photo-1566417713940-fe7c737a9ef2?w=800&q=80',
                  'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=800&q=80'],
  active:        ['https://images.unsplash.com/photo-1502904550040-7534597429ae?w=800&q=80',
                  'https://images.unsplash.com/photo-1530549387789-4c1017266635?w=800&q=80'],
  hidden_gems:   ['https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80',
                  'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=800&q=80'],
  shopping:      ['https://images.unsplash.com/photo-1481437156560-3205f6a55735?w=800&q=80',
                  'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=800&q=80'],
  default:       ['https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800&q=80',
                  'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&q=80'],
}

function pickStockImage(place) {
  const data = place?.placeData || place || {}
  const rawCategory = data.category ?? place?.category
  const key = typeof rawCategory === 'string'
    ? rawCategory
    : (rawCategory && typeof rawCategory === 'object' ? rawCategory.key : 'default')
  const bucket = CATEGORY_STOCK[key] || CATEGORY_STOCK.default
  // Deterministic by place id so the same place always shows the same
  // stock image (no flicker if the card is re-mounted).
  const id = String(data.id ?? place?.id ?? data.placeId ?? '')
  const idx = id ? Math.abs(id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % bucket.length : 0
  return bucket[idx]
}

/**
 * Returns the best-known image URL, falling back through:
 *   1. Sync image fields already on the place
 *   2. Multi-source server resolver (Wiki/Wikidata/Commons/website/geosearch)
 *   3. Category stock photo (Unsplash) — last resort so every card has a photo
 * Always returns a URL. Callers don't need a placeholder anymore.
 */
export async function resolvePlaceImageAsync(place) {
  const sync = resolvePlaceImageSync(place)
  if (sync) return sync
  const resolved = await fetchEnhancedImage(place)
  if (resolved) return resolved
  return pickStockImage(place)
}

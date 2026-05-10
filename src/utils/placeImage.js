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

const WIKI_CACHE_KEY = 'roam_wiki_image_cache_v1'
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

async function fetchWikipediaThumb(wikipediaTag) {
  const summary = await fetchWikipediaSummary(wikipediaTag)
  return summary?.thumbnail || null
}

/**
 * Returns the best-known image URL, falling back to a Wikipedia thumbnail
 * for places with a wikipedia/wikidata tag. Returns null if nothing is
 * available — caller renders the stylized placeholder.
 */
export async function resolvePlaceImageAsync(place) {
  const sync = resolvePlaceImageSync(place)
  if (sync) return sync

  const data = place?.placeData || place || {}
  const wiki =
    data.wikipedia ||
    data.tags?.wikipedia ||
    null
  if (!wiki) return null

  return await fetchWikipediaThumb(wiki)
}

/**
 * ROAM API Client
 * Handles fetching places from multiple data sources:
 * - OpenStreetMap via Overpass API (primary)
 * - OpenTripMap for tourist attractions (enrichment)
 * - Wikipedia Geosearch for notable places (discovery)
 * - Wikipedia/Wikidata for descriptions and images (enrichment)
 *
 * All requests go through the Request Manager for:
 * - Rate limiting per source
 * - Circuit breaker pattern (auto-disable failing sources)
 * - Request deduplication
 * - Caching with geographic bucketing
 */

import { getAllGoodTypes, getTypesForCategory } from './categories'
import { managedFetch, rankEndpoints, recordEndpoint } from './requestManager'
import { makeCacheKey, makeKey, getWithSWR } from './geoCache'
import { selectBestImage } from './imageScoring'
import { groupTypesByKey, countQueryClauses } from './osmTagMapping'
import { recordApiCall } from './apiTelemetry'

// Public Overpass instances — full list per OSM wiki at
// https://wiki.openstreetmap.org/wiki/Overpass_API. Two main, two
// regional mirrors. All accept the same QL and emit CORS headers so
// browser fetch() works directly without a proxy.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
]

const WIKIPEDIA_API = 'https://en.wikipedia.org/api/rest_v1'
const WIKIPEDIA_ACTION_API = 'https://en.wikipedia.org/w/api.php'

// OpenTripMap is now proxied through our API routes for security
// See /api/places/opentripmap/nearby.js and /api/places/opentripmap/details.js

/**
 * Build Overpass query for places
 * Uses type-to-key mapping to only query relevant OSM keys
 *
 * Timeout scales with radius:
 * - <10km: 30s
 * - 10-30km: 60s (driving mode)
 * - >30km: 90s
 *
 * Only apply name filter for very large radii (>50km) to avoid empty results
 *
 * OPTIMIZATION: Instead of querying all 8 OSM keys for every type,
 * we now group types by their actual keys. This reduces query size by ~70%.
 */

function escapeOverpassRegex(value) {
  return value.replace(/[\\.^$|?*+()[\]{}]/g, '\\$&')
}

/**
 * Convert lat/lng + radius to bounding box
 * bbox is MUCH faster than around for Overpass queries
 */
function radiusToBbox(lat, lng, radius) {
  // Rough conversion: 1 degree lat ≈ 111km, lng varies by latitude
  const latDelta = radius / 111320
  const lngDelta = radius / (111320 * Math.cos(lat * Math.PI / 180))

  return {
    south: lat - latDelta,
    north: lat + latDelta,
    west: lng - lngDelta,
    east: lng + lngDelta
  }
}

function buildOverpassQuery(lat, lng, radius, types) {
  // Vercel Edge functions have ~30s limit, so cap Overpass timeout at 20s
  // (leaves buffer for network latency and Edge function overhead)
  const timeout = 20

  // Only filter by name for VERY large radii (>50km) - Explorer mode
  const isVeryLargeRadius = radius > 50000
  const nameFilter = isVeryLargeRadius ? '["name"]' : ''

  const uniqueTypes = Array.from(new Set(types)).filter(Boolean)
  if (uniqueTypes.length === 0) {
    return {
      query: `[out:json][timeout:${timeout}];();out center;`,
      clauseCount: 0,
      querySize: 0
    }
  }

  // Use bbox instead of around - SIGNIFICANTLY faster per Overpass docs
  const bbox = radiusToBbox(lat, lng, radius)

  // Group types by their OSM keys - reduces clauses by ~70%
  const grouped = groupTypesByKey(uniqueTypes)

  // Build query clauses - global bbox applies to all statements
  const typeFilters = Object.entries(grouped)
    .map(([key, keyTypes]) => {
      const regex = keyTypes.map(escapeOverpassRegex).join('|')
      return `nw["${key}"~"^(${regex})$"]${nameFilter};`
    })
    .join('\n      ')

  // Global bbox setting applies to ALL statements - no need for per-statement bbox.
  // `out tags center;` returns the centroid (lat/lng for ways/relations) AND
  // all tags. Without `tags`, we'd lose wikipedia/wikidata/image/opening_hours/
  // website/phone — every place ends up as just a name + coords. This is the
  // upstream fix for "all places look generic": OSM has the data, we just
  // weren't asking for it. Slightly bigger response (~2-3x), but cached at
  // the edge so the cost is paid once per geographic tile per day.
  const query = `[out:json][timeout:${timeout}][bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];
(
${typeFilters}
);
out tags center;`

  return {
    query,
    clauseCount: countQueryClauses(uniqueTypes),
    querySize: query.length
  }
}

// Active request controller for cancellation
let activeOverpassController = null

// Overpass proxy endpoint for edge caching
const OVERPASS_PROXY = '/api/places/overpass/nearby'

// Track proxy health to avoid repeated failures
let proxyLastFailed = 0
const PROXY_RETRY_DELAY = 60000 // 1 minute before retrying proxy after failure

/**
 * Fetch places from Overpass API via proxy (for edge caching) with fallback to direct
 * Proxy provides edge caching (1 hour) and better server-to-server network
 *
 * @param {string} query - Overpass QL query string
 * @param {AbortSignal} [signal] - Optional AbortSignal for cancellation
 * @param {Object} [meta] - Query metadata for telemetry
 * @returns {Promise<Object>} Overpass response data
 */
async function fetchFromOverpass(query, signal = null, meta = {}) {
  // The proxy is meant to give us CDN-cached responses, but Vercel
  // doesn't cache POSTs by default — so on cache miss we eat the full
  // upstream latency (sometimes 60s+ for dense urban bboxes, after
  // which Vercel kills the function with 504). Meanwhile, calling
  // overpass-api.de directly from the browser/Capacitor takes 1-3s
  // for the same query because the public Overpass instance has its
  // own internal cache and no Vercel timeout in the path.
  //
  // Strategy: try the proxy with a SHORT abort timeout (so if it's
  // going to time out, we know within 8s, not 60s). On any failure
  // or timeout, immediately fall back to direct fetch. We still
  // benefit from the proxy when it succeeds (cache miss is rare on
  // popular tiles after a few minutes), and we no longer leave users
  // staring at a spinner for a minute when it doesn't.
  const PROXY_CLIENT_TIMEOUT_MS = 8000

  const now = Date.now()
  if (now - proxyLastFailed > PROXY_RETRY_DELAY) {
    const proxyAbort = new AbortController()
    const proxyTimeoutId = setTimeout(() => proxyAbort.abort(), PROXY_CLIENT_TIMEOUT_MS)
    // Chain external cancellation so we still abort if the caller cancels
    const onExternalAbort = () => proxyAbort.abort()
    if (signal) signal.addEventListener('abort', onExternalAbort, { once: true })

    try {
      const startTime = Date.now()
      const response = await fetch(OVERPASS_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: proxyAbort.signal
      })

      clearTimeout(proxyTimeoutId)
      if (signal) signal.removeEventListener('abort', onExternalAbort)

      if (response.ok) {
        const data = await response.json()
        const duration = Date.now() - startTime

        recordApiCall({
          source: 'overpass_proxy',
          endpoint: OVERPASS_PROXY,
          duration,
          status: 'success',
          resultCount: data.elements?.length || 0,
          querySize: meta.querySize,
          clauseCount: meta.clauseCount
        })

        return data
      }

      // Proxy returned error — mark failed, fall through to direct
      proxyLastFailed = now
    } catch (error) {
      clearTimeout(proxyTimeoutId)
      if (signal) signal.removeEventListener('abort', onExternalAbort)

      // Caller cancelled — re-throw
      if (signal?.aborted) throw error

      // Otherwise this is either our 8s timeout firing OR a network
      // error — both are "proxy not viable, go direct."
      proxyLastFailed = now
      console.warn('[Overpass] Proxy slow/failed, going direct:', error.message)
    }
  }

  return fetchFromOverpassDirect(query, signal, meta)
}

/**
 * Fetch places directly from Overpass API with fallback and telemetry
 * Endpoints are ranked by performance - fastest/most reliable first
 *
 * @param {string} query - Overpass QL query string
 * @param {AbortSignal} [signal] - Optional AbortSignal for cancellation
 * @param {Object} [meta] - Query metadata for telemetry
 * @returns {Promise<Object>} Overpass response data
 */
async function fetchFromOverpassDirect(query, signal = null, meta = {}) {
  const { clauseCount, querySize } = meta

  // Rank endpoints by historical performance
  const rankedEndpoints = rankEndpoints(OVERPASS_ENDPOINTS)

  for (const endpoint of rankedEndpoints) {
    const startTime = Date.now()

    try {
      // Direct-from-client fallback — only runs if our server proxy is
      // down. Browsers forbid setting a custom User-Agent on fetch(),
      // so OSM sees the user's browser UA (acceptable per their TOS).
      // The proxy at /api/places/overpass/nearby sets a proper UA when
      // the request is server-side; this path is a degraded fallback.
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal
      })

      if (response.ok) {
        const data = await response.json()
        const duration = Date.now() - startTime

        // Record endpoint performance for ranking
        recordEndpoint(endpoint, true, duration)

        // Record successful telemetry
        recordApiCall({
          source: 'overpass',
          endpoint,
          duration,
          status: 'success',
          resultCount: data.elements?.length || 0,
          querySize,
          clauseCount
        })

        return data
      }

      // Non-OK response
      const duration = Date.now() - startTime
      recordEndpoint(endpoint, false, duration)
      recordApiCall({
        source: 'overpass',
        endpoint,
        duration,
        status: 'error',
        error: `HTTP ${response.status}`,
        querySize,
        clauseCount
      })
    } catch (error) {
      const duration = Date.now() - startTime

      // Handle cancellation
      if (error.name === 'AbortError') {
        recordApiCall({
          source: 'overpass',
          endpoint,
          duration,
          status: 'cancelled',
          querySize,
          clauseCount
        })
        throw error // Re-throw to let caller handle
      }

      // Record failure for endpoint ranking
      recordEndpoint(endpoint, false, duration)

      // Record failure telemetry and try next endpoint
      recordApiCall({
        source: 'overpass',
        endpoint,
        duration,
        status: 'error',
        error: error.message,
        querySize,
        clauseCount
      })

      console.warn(`Overpass endpoint failed: ${endpoint}`, error)
    }
  }

  throw new Error('All Overpass endpoints failed')
}

/**
 * Calculate a quality score for a place based on available OSM data
 * Higher scores = likely better, more interesting, more local places
 *
 * @param {Object} tags - OSM tags for the place
 * @returns {number} Quality score from 0-100
 */
function calculatePlaceQuality(tags) {
  let score = 40 // Base score

  // Has a proper name (not just type)
  if (tags.name && tags.name.length > 3) score += 5

  // Has contact info (indicates active, cared-for record)
  if (tags.phone || tags['contact:phone']) score += 5
  if (tags.website || tags['contact:website']) score += 5

  // Has opening hours (indicates maintained data)
  if (tags.opening_hours) score += 5

  // Has description (indicates notable place)
  if (tags.description) score += 10

  // Wikipedia/Wikidata — strongest single quality signal in OSM.
  // A place tagged wikipedia=* is documented elsewhere, almost
  // always worth visiting.
  if (tags.wikipedia) score += 20
  if (tags.wikidata) score += 10

  // Heritage / listed building (designated by national heritage body)
  if (tags.heritage || tags['listed_status'] || tags['HE_ref']) score += 15

  // OSM mapper hung a photo on the place — sparse but high-signal.
  if (tags.image || tags.wikimedia_commons) score += 10

  // POSITIVE: tourism=* overlays are explicit visit-worthy markers
  // from OSM contributors. Previously this code PENALISED them
  // (-10/-15) on the misread that "tourist trap" meant tourist
  // attraction — completely backwards. tourism=attraction is the
  // OSM tag for the Eiffel Tower, Stonehenge, Empire State
  // Building, etc. — we should be boosting these heavily.
  if (tags.tourism === 'attraction') score += 15
  if (tags.tourism === 'theme_park') score += 10
  if (tags.tourism === 'viewpoint') score += 10
  if (tags.tourism === 'museum') score += 15
  if (tags.tourism === 'zoo' || tags.tourism === 'aquarium') score += 10

  // Fee=yes (paid entry) usually means a real ticketed attraction,
  // not just a tagged spot on the map.
  if (tags.fee === 'yes') score += 5

  // Bonus for places with cuisine info (specific food identity)
  if (tags.cuisine && !tags.brand) score += 5

  // Bonus for local/independent / artisanal markers
  if (tags.craft) score += 10

  // Chain stores — moderate penalty. Some chains ARE destinations
  // (IKEA flagship, Apple Store, Hard Rock Café) so we don't
  // hammer them too hard. Was -20 which essentially killed every
  // branded place; -8 is enough to surface independents first
  // without erasing chains entirely.
  if (tags.brand) score -= 8

  return Math.max(0, Math.min(100, score))
}

/**
 * Parse Overpass response into place objects
 */
function parseOverpassResponse(data) {
  if (!data.elements) return []

  return data.elements.map(element => {
    const tags = element.tags || {}
    const lat = element.lat || element.center?.lat
    const lng = element.lon || element.center?.lon

    // Determine type from various OSM tags (expanded for UK)
    const type = tags.amenity || tags.tourism || tags.leisure || tags.historic ||
                 tags.shop || tags.natural || tags.man_made || tags.landuse || 'place'

    // Calculate a basic quality score based on available data
    const qualityScore = calculatePlaceQuality(tags)

    return {
      id: element.id,
      name: tags.name || tags['name:en'] || 'Unnamed Place',
      type,
      lat,
      lng,
      address: formatAddress(tags),
      phone: tags.phone || tags['contact:phone'],
      website: tags.website || tags['contact:website'],
      openingHours: tags.opening_hours,
      description: tags.description || tags['description:en'],
      wheelchair: tags.wheelchair,
      wikipedia: tags.wikipedia,
      wikidata: tags.wikidata,
      // OSM image tags — a mapper sometimes hangs a direct photo URL
      // on the node ('image=https://…') or a Wikimedia Commons file
      // ('wikimedia_commons=File:Foo.jpg'). These are author-vetted
      // for the specific place (vs Commons geosearch which is anything
      // tagged near the location), so they're high-relevance and we
      // should consume them when present. Coverage is sparse but
      // basically free real-estate.
      image: tags.image,
      wikimedia_commons: tags.wikimedia_commons,
      cuisine: tags.cuisine,
      outdoor_seating: tags.outdoor_seating,
      takeaway: tags.takeaway,
      delivery: tags.delivery,
      // Additional useful tags for UK
      heritage: tags.heritage,
      listed_status: tags['listed_status'] || tags['HE_ref'],
      designation: tags.designation,
      // Tags for premium filters
      tourism: tags.tourism,
      brand: tags.brand,
      fee: tags.fee,
      qualityScore
    }
  }).filter(place => place.lat && place.lng && place.name !== 'Unnamed Place')
}

/**
 * Format address from OSM tags
 */
function formatAddress(tags) {
  const parts = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:city'],
    tags['addr:postcode']
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Fetch nearby places from OSM via Overpass
 * Uses managed fetch for rate limiting and caching
 *
 * For large radii (>15km), we use a more focused query strategy:
 * - Fewer types per query to avoid timeouts
 * - Prioritize types that typically have named/notable places
 *
 * Supports request cancellation via AbortController for rapid category changes.
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radius - Search radius in meters
 * @param {string|null} category - Category key or null for all
 * @param {AbortSignal} [signal] - Optional AbortSignal for cancellation
 * @returns {Promise<Array>} Array of places
 */
export async function fetchNearbyPlaces(lat, lng, radius = 5000, category = null, signal = null) {
  const cacheKey = makeCacheKey(lat, lng, radius, category)

  const result = await managedFetch('overpass', cacheKey, async () => {
    // Check if already cancelled before starting
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const types = category ? getTypesForCategory(category) : getAllGoodTypes()

    // For large radii, reduce types and prioritize important ones
    const isLargeRadius = radius > 15000
    const maxTypes = isLargeRadius ? 20 : 35

    // Prioritize types that typically have named, notable places for large radii
    const priorityTypes = isLargeRadius
      ? ['attraction', 'museum', 'castle', 'ruins', 'monument', 'viewpoint', 'park', 'nature_reserve',
         'restaurant', 'pub', 'cafe', 'cinema', 'theatre', 'artwork', 'memorial', 'beach', 'waterfall']
      : []

    // Build limited types list with priorities
    let limitedTypes
    if (priorityTypes.length > 0) {
      const priority = types.filter(t => priorityTypes.includes(t))
      const others = types.filter(t => !priorityTypes.includes(t))
      limitedTypes = [...priority, ...others].slice(0, maxTypes)
    } else {
      limitedTypes = types.slice(0, maxTypes)
    }

    // Build query with metadata for telemetry
    const { query, clauseCount, querySize } = buildOverpassQuery(lat, lng, radius, limitedTypes)
    const data = await fetchFromOverpass(query, signal, { clauseCount, querySize })

    return parseOverpassResponse(data)
  }, { ttl: 10 * 60 * 1000 }) // 10 minute cache

  return result || []
}

/**
 * Cancel any active Overpass request
 * Call this before starting a new request to prevent stale responses
 */
export function cancelOverpassRequest() {
  if (activeOverpassController) {
    activeOverpassController.abort()
    activeOverpassController = null
  }
}

/**
 * Create a new AbortController for Overpass requests
 * Automatically cancels any previous active request
 *
 * @returns {AbortController} New controller for the request
 */
export function createOverpassController() {
  cancelOverpassRequest()
  activeOverpassController = new AbortController()
  return activeOverpassController
}

// ═══════════════════════════════════════════════════════
// LARGE RADIUS STRATEGY
// For very large radii (Explorer/Day Trip), use sampling instead of tiling
// to avoid rate limits (15+ requests = 429 errors)
// ═══════════════════════════════════════════════════════

const TILE_SIZE = 35000 // 35km tiles (larger = fewer requests)
const MAX_TILES = 5 // Hard limit on tiles to avoid rate limits
const BATCH_DELAY_MS = 2000 // Delay between batches to respect rate limits

/**
 * Generate sample points for a large radius search
 * Uses center + cardinal directions instead of full ring
 * Max 5 tiles to avoid rate limiting
 */
function sampleLargeRadius(lat, lng, radius) {
  // For moderate radii, just use the full area
  if (radius <= TILE_SIZE * 1.2) {
    return [{ lat, lng, radius }]
  }

  // For large radii, sample center + 4 cardinal directions
  // This gives good coverage with only 5 requests max
  const tiles = [{ lat, lng, radius: TILE_SIZE }] // Center

  // Sample distance - halfway to edge
  const sampleDist = radius * 0.5

  // Cardinal directions (N, E, S, W)
  const offsets = [
    { latMult: 1, lngMult: 0 },  // North
    { latMult: 0, lngMult: 1 },  // East
    { latMult: -1, lngMult: 0 }, // South
    { latMult: 0, lngMult: -1 }, // West
  ]

  for (const { latMult, lngMult } of offsets) {
    const latOffset = (sampleDist / 111320) * latMult
    const lngOffset = (sampleDist / (111320 * Math.cos(lat * Math.PI / 180))) * lngMult
    tiles.push({
      lat: lat + latOffset,
      lng: lng + lngOffset,
      radius: TILE_SIZE
    })
  }

  return tiles.slice(0, MAX_TILES)
}

/**
 * Delay helper
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Fetch places with progressive loading for large radii
 * Returns CENTER results immediately, loads outer tiles in background
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radius - Search radius in meters
 * @param {string|null} category - Category key or null for all
 * @param {AbortSignal} [signal] - Optional AbortSignal for cancellation
 * @param {Function} [onProgress] - Callback with new places as they load
 * @returns {Promise<Array>} Initial places (center tile)
 */
export async function fetchWithTiling(lat, lng, radius, category = null, signal = null, onProgress = null) {
  const tiles = sampleLargeRadius(lat, lng, radius)

  // Single tile = use normal fetch
  if (tiles.length === 1) {
    return fetchNearbyPlaces(lat, lng, radius, category, signal)
  }


  const seen = new Set()
  const addUnique = (places) => {
    const newPlaces = []
    for (const place of places) {
      if (!seen.has(place.id)) {
        seen.add(place.id)
        newPlaces.push(place)
      }
    }
    return newPlaces
  }

  // STEP 1: Fetch CENTER tile immediately and return it
  const centerTile = tiles[0]
  let centerPlaces = []
  try {
    centerPlaces = await fetchNearbyPlaces(centerTile.lat, centerTile.lng, centerTile.radius, category, signal)
    centerPlaces = addUnique(centerPlaces)
  } catch (err) {
    if (err.name === 'AbortError') throw err
    console.warn('Center tile failed:', err)
  }

  // STEP 2: Fetch outer tiles in BACKGROUND (don't await)
  if (tiles.length > 1 && !signal?.aborted) {
    const outerTiles = tiles.slice(1)

    // Fire and forget - load outer tiles with delays
    ;(async () => {
      for (let i = 0; i < outerTiles.length; i++) {
        if (signal?.aborted) break

        await delay(BATCH_DELAY_MS)
        if (signal?.aborted) break

        const tile = outerTiles[i]
        try {
          const places = await fetchNearbyPlaces(tile.lat, tile.lng, tile.radius, category, signal)
          const newPlaces = addUnique(places)

          // Notify caller of new places
          if (newPlaces.length > 0 && onProgress) {
            onProgress(newPlaces)
          }
        } catch (err) {
          if (err.name === 'AbortError') break
          // Outer tile failures are non-critical, continue with next tile
        }
      }
    })()
  }

  // Return center places immediately - outer tiles load in background
  return centerPlaces
}

// Geocoding + weather + Wikipedia helpers + OpenTripMap extracted into
// focused modules. Wikipedia + OpenTripMap helpers are still called from
// INSIDE this file (fetchEnrichedPlaces, enrichPlace, fetchPlaceById), so
// we have to import them explicitly — `export { x } from './y'` re-exports
// to external call sites but does NOT bring `x` into the module's own scope.
// Geocode + weather have no internal callers so a pure re-export is fine.
export { reverseGeocode, geocodeAddress } from './apiClient/geocode'
export { fetchWeather, getWeatherDescription } from './apiClient/weather'

import {
  fetchWikipediaImage,
  fetchWikidataImage,
  fetchWikipediaSummary,
} from './apiClient/wikipedia'
import {
  fetchOpenTripMapPlaces,
  fetchOpenTripMapDetails,
  mapOtmKind,
} from './apiClient/opentripmap'

export { fetchWikipediaImage, fetchWikidataImage, fetchWikipediaSummary }
export { fetchOpenTripMapPlaces, fetchOpenTripMapDetails, mapOtmKind }

// ═══════════════════════════════════════════════════════
// WIKIPEDIA GEOSEARCH - Notable places discovery
// ═══════════════════════════════════════════════════════

/**
 * Fetch notable places from Wikipedia Geosearch
 * This is a FREE API with no authentication required
 * Returns places that have Wikipedia articles (notable/interesting)
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radius - Search radius in meters (max 10000)
 * @returns {Promise<Array>} Array of places
 */
export async function fetchWikipediaPlaces(lat, lng, radius = 5000) {
  const cacheKey = makeKey('wiki_geo', lat, lng, radius)

  const result = await managedFetch('wikipedia', cacheKey, async () => {
    // Wikipedia geosearch API - max radius is 10km
    const searchRadius = Math.min(radius, 10000)

    const params = new URLSearchParams({
      action: 'query',
      list: 'geosearch',
      gscoord: `${lat}|${lng}`,
      gsradius: searchRadius.toString(),
      gslimit: '50',
      format: 'json',
      origin: '*'  // Required for CORS
    })

    const response = await fetch(`${WIKIPEDIA_ACTION_API}?${params}`)

    if (!response.ok) {
      throw new Error(`Wikipedia geosearch failed: ${response.status}`)
    }

    const data = await response.json()

    if (!data.query?.geosearch) {
      return []
    }

    return data.query.geosearch.map(place => ({
      id: `wiki_${place.pageid}`,
      pageid: place.pageid,
      name: place.title,
      lat: place.lat,
      lng: place.lon,
      type: 'notable_place',
      source: 'wikipedia',
      distance: place.dist,
      // Mark for potential enrichment
      wikipedia: `en:${place.title}`
    }))
  }, { ttl: 15 * 60 * 1000 }) // 15 minute cache

  return result || []
}

// ═══════════════════════════════════════════════════════
// COMBINED DATA FETCHING - Merge multiple sources
// ═══════════════════════════════════════════════════════

/**
 * Fetch places from multiple sources and merge results
 * Uses all three data sources with individual failure handling:
 * - OSM/Overpass (primary - high volume)
 * - OpenTripMap (curated tourist spots)
 * - Wikipedia Geosearch (notable/famous places, max 10km)
 *
 * For large radii, uses progressive loading - returns center immediately,
 * loads outer areas in background and calls onProgress with new places.
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radius - Search radius in meters
 * @param {string|null} category - Category key or null for all
 * @param {Function} [onProgress] - Callback for progressive loading (new places array)
 * @returns {Promise<Array>} Merged array of places
 */
export async function fetchEnrichedPlaces(lat, lng, radius = 5000, category = null, onProgress = null) {
  const isLargeRadius = radius > 15000

  // For large radii, fetch Wikipedia from multiple sample points
  // to better cover the search area (since Wiki max radius is 10km)
  const wikiPromises = []
  if (isLargeRadius) {
    // Sample center + 4 cardinal directions at 60% of radius
    const sampleDistance = radius * 0.6 / 111320 // Convert to degrees (rough)
    const wikiRadius = 10000 // Max wiki radius

    wikiPromises.push(
      fetchWikipediaPlaces(lat, lng, wikiRadius).catch(() => []),
      fetchWikipediaPlaces(lat + sampleDistance, lng, wikiRadius).catch(() => []),
      fetchWikipediaPlaces(lat - sampleDistance, lng, wikiRadius).catch(() => []),
      fetchWikipediaPlaces(lat, lng + sampleDistance, wikiRadius).catch(() => []),
      fetchWikipediaPlaces(lat, lng - sampleDistance, wikiRadius).catch(() => [])
    )
  } else {
    wikiPromises.push(
      fetchWikipediaPlaces(lat, lng, Math.min(radius, 10000)).catch(() => [])
    )
  }

  // Use progressive loading for very large radii (>40km)
  const usesTiling = radius > 40000
  const osmFetcher = usesTiling
    ? fetchWithTiling(lat, lng, radius, category, null, onProgress).catch(err => {
        console.warn('OSM progressive fetch failed:', err)
        return []
      })
    : fetchNearbyPlaces(lat, lng, radius, category).catch(err => {
        console.warn('OSM fetch failed:', err)
        return []
      })

  // OpenTripMap proxy hard-caps radius at 50km — anything above 400s server-side.
  // For Day Trip (75km) and Explorer (150km), skip OTM entirely rather than waste
  // the round-trip + log noise. OSM tiling already covers the area, and OTM has
  // been winding down with silently-revoked keys anyway (see the proxy comment).
  const otmFetcher = radius > 50000
    ? Promise.resolve([])
    : fetchOpenTripMapPlaces(lat, lng, radius).catch(err => {
        console.warn('OpenTripMap fetch failed:', err)
        return []
      })

  // Fetch from ALL sources in parallel with individual failure handling
  const [osmPlaces, otmPlaces, ...wikiResults] = await Promise.all([
    osmFetcher,
    otmFetcher,
    ...wikiPromises
  ])

  // Merge all wiki results
  const wikiPlaces = wikiResults.flat()

  // Merge and deduplicate all sources
  return mergeAndDedupe(osmPlaces, otmPlaces, wikiPlaces)
}

/**
 * Merge places from multiple sources, removing duplicates
 * Prioritizes OSM data, enriches with OTM/Wiki when available
 */
function mergeAndDedupe(osmPlaces, otmPlaces, wikiPlaces) {
  // Create maps for deduplication by location and name
  const byLocation = new Map()
  const seenNames = new Set()

  // Helper to create location key
  const locationKey = (place) => `${place.lat.toFixed(4)},${place.lng.toFixed(4)}`

  // Helper to normalize names for comparison
  const normalizeName = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

  // Add OSM places first (primary source)
  const merged = []
  for (const place of osmPlaces) {
    const key = locationKey(place)
    const normalName = normalizeName(place.name)

    if (!byLocation.has(key)) {
      byLocation.set(key, [])
    }
    byLocation.get(key).push(place)
    seenNames.add(normalName)
    merged.push({ ...place, source: 'osm' })
  }

  // Add OpenTripMap places (curated tourist data)
  for (const place of otmPlaces) {
    const normalName = normalizeName(place.name)

    // Skip if we already have this exact name
    if (seenNames.has(normalName)) continue

    // Check for similar nearby places
    const key = locationKey(place)
    const nearby = byLocation.get(key) || []
    const hasSimilar = nearby.some(existing => {
      const existingNorm = normalizeName(existing.name)
      return existingNorm.includes(normalName) ||
             normalName.includes(existingNorm)
    })

    if (hasSimilar) continue

    // Add the place
    if (!byLocation.has(key)) {
      byLocation.set(key, [])
    }
    byLocation.get(key).push(place)
    seenNames.add(normalName)
    merged.push({
      ...place,
      needsEnrichment: true
    })
  }

  // Add Wikipedia places (notable/famous)
  for (const place of wikiPlaces) {
    const normalName = normalizeName(place.name)

    // Skip if we already have this exact name
    if (seenNames.has(normalName)) continue

    // Check for similar nearby places
    const key = locationKey(place)
    const nearby = byLocation.get(key) || []
    const hasSimilar = nearby.some(existing => {
      const existingNorm = normalizeName(existing.name)
      return existingNorm.includes(normalName) ||
             normalName.includes(existingNorm)
    })

    if (hasSimilar) {
      // Enrich existing place with Wikipedia reference if missing
      const similar = nearby.find(p => !p.wikipedia)
      if (similar) {
        similar.wikipedia = place.wikipedia
      }
      continue
    }

    // Add the place
    if (!byLocation.has(key)) {
      byLocation.set(key, [])
    }
    byLocation.get(key).push(place)
    seenNames.add(normalName)
    merged.push({
      ...place,
      needsEnrichment: true
    })
  }

  return merged
}

/**
 * Fetch places with stale-while-revalidate pattern
 * Returns cached data immediately (even if stale) for fast UI,
 * then refreshes in the background
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radius - Search radius in meters
 * @param {string|null} category - Category key or null for all
 * @param {Function} onRefresh - Callback when fresh data is available
 * @returns {Promise<{data: Array, fresh: boolean, stale: boolean}>}
 */
export async function fetchPlacesWithSWR(lat, lng, radius = 5000, category = null, onRefresh = null, onProgress = null, { force = false } = {}) {
  const cacheKey = makeCacheKey(lat, lng, radius, category)

  return getWithSWR(
    cacheKey,
    () => fetchEnrichedPlaces(lat, lng, radius, category, onProgress),
    {
      ttl: 10 * 60 * 1000, // 10 minute freshness
      onBackgroundRefresh: onRefresh,
      force
    }
  )
}

// Cache for enriched place data (30 minute TTL)
const enrichPlaceCache = new Map()
const ENRICH_CACHE_TTL = 30 * 60 * 1000 // 30 minutes

/**
 * Get cached enriched place data
 * @param {string} placeId - Place ID
 * @returns {Object|null} - Cached data or null
 */
function getEnrichedFromCache(placeId) {
  const entry = enrichPlaceCache.get(placeId)
  if (!entry) return null
  if (Date.now() > entry.expires) {
    enrichPlaceCache.delete(placeId)
    return null
  }
  return entry.data
}

/**
 * Cache enriched place data
 * @param {string} placeId - Place ID
 * @param {Object} data - Enriched place data
 */
function cacheEnrichedPlace(placeId, data) {
  // Limit cache size
  if (enrichPlaceCache.size > 200) {
    // Remove oldest 20%
    const entries = Array.from(enrichPlaceCache.entries())
      .sort((a, b) => a[1].expires - b[1].expires)
    const toRemove = Math.ceil(entries.length * 0.2)
    for (let i = 0; i < toRemove; i++) {
      enrichPlaceCache.delete(entries[i][0])
    }
  }

  enrichPlaceCache.set(placeId, {
    data,
    expires: Date.now() + ENRICH_CACHE_TTL
  })
}

/**
 * Enrich a single place with additional data (Wikipedia, OTM details)
 * Call this for places shown in detail view, not for list view
 * Uses caching with 30 minute TTL for fast subsequent loads
 * @param {Object} place - Place object
 * @returns {Promise<Object>} Enriched place
 */
export async function enrichPlace(place) {
  // Check cache first
  const cached = getEnrichedFromCache(place.id)
  if (cached) {
    return cached
  }
  const enriched = { ...place }
  const imagePromises = []

  // Fetch all sources in parallel for better performance
  const fetchPromises = []

  // OTM details fetch
  if (place.xid && !place.description) {
    fetchPromises.push(
      fetchOpenTripMapDetails(place.xid).then(details => {
        if (details) {
          enriched.description = details.description || enriched.description
          enriched.address = details.address || enriched.address
          enriched.website = details.website || enriched.website
          if (details.image) {
            imagePromises.push(Promise.resolve({
              url: details.image,
              source: 'opentripmap',
              width: null,
              height: null
            }))
          }
        }
        return details
      })
    )
  }

  // Wikipedia summary fetch
  if (place.wikipedia) {
    fetchPromises.push(
      fetchWikipediaSummary(place.wikipedia).then(wiki => {
        if (wiki) {
          if (!enriched.description) {
            enriched.description = wiki.extractShort || enriched.description
          }
          enriched.wikipediaUrl = wiki.url
          if (wiki.image) {
            imagePromises.push(Promise.resolve({
              url: wiki.image,
              source: 'wikipedia',
              width: wiki.imageWidth || null,
              height: wiki.imageHeight || null
            }))
          }
        }
        return wiki
      })
    )
  }

  // Wikidata image fetch
  if (place.wikidata) {
    fetchPromises.push(
      fetchWikidataImage(place.wikidata).then(image => {
        if (image) {
          imagePromises.push(Promise.resolve({
            url: image,
            source: 'wikidata',
            width: null,
            height: null
          }))
        }
        return image
      })
    )
  }

  // Wait for all fetches to complete
  await Promise.allSettled(fetchPromises)

  // Select the best image from all candidates using scoring
  const imageCandidates = await Promise.all(imagePromises)
  const validCandidates = imageCandidates.filter(c => c && c.url)

  if (validCandidates.length > 0) {
    const bestImage = selectBestImage(validCandidates)
    if (bestImage) {
      enriched.image = bestImage.url
      enriched.imageSource = bestImage.source
    }
  }

  // Cache the enriched result for fast subsequent loads
  cacheEnrichedPlace(place.id, enriched)

  return enriched
}

/**
 * Fetch a single place by ID
 * Tries OSM/Overpass API to get place details
 *
 * @param {string|number} placeId - Place ID (OSM node/way ID or prefixed ID)
 * @returns {Promise<Object|null>} Place data or null if not found
 */
export async function fetchPlaceById(placeId) {
  // Handle prefixed IDs from different sources
  if (typeof placeId === 'string') {
    if (placeId.startsWith('otm_')) {
      const xid = placeId.replace('otm_', '')
      const details = await fetchOpenTripMapDetails(xid)
      if (details) {
        return {
          id: placeId,
          xid,
          ...details,
          source: 'opentripmap'
        }
      }
      return null
    }

    if (placeId.startsWith('wiki_')) {
      // Wikipedia places need enrichment via Wikipedia summary
      // We don't have a direct API for fetching by Wikipedia page ID, return null
      return null
    }
  }

  // Standard OSM ID - fetch via Overpass
  const numericId = parseInt(placeId, 10)
  if (isNaN(numericId)) return null

  try {
    const query = `
      [out:json][timeout:10];
      (
        node(${numericId});
        way(${numericId});
      );
      out body center;
    `

    const data = await fetchFromOverpass(query)
    const places = parseOverpassResponse(data)

    if (places.length > 0) {
      return { ...places[0], source: 'osm' }
    }
  } catch (error) {
    console.warn('Failed to fetch place by ID:', error)
  }

  return null
}

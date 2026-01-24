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
import { managedFetch, isCircuitOpen, rankEndpoints, recordEndpoint } from './requestManager'
import { makeCacheKey, makeKey, getWithSWR } from './geoCache'
import { selectBestImage } from './imageScoring'
import { groupTypesByKey, countQueryClauses } from './osmTagMapping'
import { recordApiCall } from './apiTelemetry'

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
]

const WIKIPEDIA_API = 'https://en.wikipedia.org/api/rest_v1'
const WIKIPEDIA_ACTION_API = 'https://en.wikipedia.org/w/api.php'
const NOMINATIM_API = 'https://nominatim.openstreetmap.org'
const OPENTRIPMAP_API = 'https://api.opentripmap.com/0.1'

// OpenTripMap API key - free tier allows 5000 requests/day
// Configure VITE_OPENTRIPMAP_KEY in .env.local for local dev
// For production, this should be proxied through a backend API route
const OTM_API_KEY = import.meta.env.VITE_OPENTRIPMAP_KEY || null

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
  // Scale timeout with radius
  let timeout = 30
  if (radius > 30000) timeout = 90
  else if (radius > 10000) timeout = 60

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
  const bboxStr = `(${bbox.south},${bbox.west},${bbox.north},${bbox.east})`

  // Group types by their OSM keys - reduces clauses by ~70%
  const grouped = groupTypesByKey(uniqueTypes)

  // Build query clauses with bbox (faster) instead of around
  const typeFilters = Object.entries(grouped)
    .map(([key, keyTypes]) => {
      const regex = keyTypes.map(escapeOverpassRegex).join('|')
      return `nw["${key}"~"^(${regex})$"]${nameFilter}${bboxStr};`
    })
    .join('\n      ')

  // Use global bbox limit + compact output
  const query = `[out:json][timeout:${timeout}][bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];
    (
      ${typeFilters}
    );
    out center;`

  return {
    query,
    clauseCount: countQueryClauses(uniqueTypes),
    querySize: query.length
  }
}

// Active request controller for cancellation
let activeOverpassController = null

/**
 * Fetch places from Overpass API with fallback and telemetry
 * Endpoints are ranked by performance - fastest/most reliable first
 *
 * @param {string} query - Overpass QL query string
 * @param {AbortSignal} [signal] - Optional AbortSignal for cancellation
 * @param {Object} [meta] - Query metadata for telemetry
 * @returns {Promise<Object>} Overpass response data
 */
async function fetchFromOverpass(query, signal = null, meta = {}) {
  const { clauseCount, querySize } = meta

  // Rank endpoints by historical performance
  const rankedEndpoints = rankEndpoints(OVERPASS_ENDPOINTS)

  for (const endpoint of rankedEndpoints) {
    const startTime = Date.now()

    try {
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

  // Has contact info (indicates active business)
  if (tags.phone || tags['contact:phone']) score += 5
  if (tags.website || tags['contact:website']) score += 5

  // Has opening hours (indicates maintained data)
  if (tags.opening_hours) score += 5

  // Has description (indicates notable place)
  if (tags.description) score += 10

  // Wikipedia/Wikidata links (indicates notable)
  if (tags.wikipedia) score += 15
  if (tags.wikidata) score += 10

  // Heritage/historical (indicates quality/interesting)
  if (tags.heritage || tags['listed_status'] || tags['HE_ref']) score += 15

  // Penalties for chain/tourist trap indicators
  if (tags.brand) score -= 20
  if (tags.tourism === 'attraction') score -= 10
  if (tags.tourism === 'theme_park') score -= 15

  // Bonus for local/independent markers
  if (tags.craft) score += 10
  if (tags['addr:country'] === 'GB' && !tags.brand) score += 5

  // Bonus for places with cuisine info (indicates local food place)
  if (tags.cuisine && !tags.brand) score += 5

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
// LARGE RADIUS TILING - Split big searches into smaller tiles
// Prevents timeouts for Explorer mode (150km) and Day Trip (75km)
// ═══════════════════════════════════════════════════════

const TILE_SIZE = 25000 // 25km tiles
const MAX_CONCURRENT_TILES = 3 // Limit parallel requests

/**
 * Generate tiles for a large radius search
 * Creates a center tile + ring of tiles at 60% radius
 *
 * @param {number} lat - Center latitude
 * @param {number} lng - Center longitude
 * @param {number} radius - Total search radius in meters
 * @returns {Array<{lat, lng, radius}>} Array of tile definitions
 */
function tileLargeRadius(lat, lng, radius) {
  // Don't tile for smaller radii
  if (radius <= TILE_SIZE * 1.5) {
    return [{ lat, lng, radius }]
  }

  const tiles = []

  // Center tile
  tiles.push({ lat, lng, radius: TILE_SIZE })

  // Ring of tiles at 60% of radius for better coverage
  const ringRadius = radius * 0.6
  const circumference = 2 * Math.PI * ringRadius
  const tileCount = Math.ceil(circumference / (TILE_SIZE * 1.5)) // Overlap for coverage

  for (let i = 0; i < tileCount; i++) {
    const angle = (2 * Math.PI * i) / tileCount
    // Convert meters to degrees (rough approximation)
    const latOffset = (ringRadius / 111320) * Math.cos(angle)
    const lngOffset = (ringRadius / (111320 * Math.cos(lat * Math.PI / 180))) * Math.sin(angle)

    tiles.push({
      lat: lat + latOffset,
      lng: lng + lngOffset,
      radius: TILE_SIZE
    })
  }

  return tiles
}

/**
 * Fetch places with tiling for large radii
 * Splits large searches into smaller tiles fetched with limited concurrency
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radius - Search radius in meters
 * @param {string|null} category - Category key or null for all
 * @param {AbortSignal} [signal] - Optional AbortSignal for cancellation
 * @returns {Promise<Array>} Deduplicated array of places
 */
export async function fetchWithTiling(lat, lng, radius, category = null, signal = null) {
  const tiles = tileLargeRadius(lat, lng, radius)

  // Single tile = use normal fetch
  if (tiles.length === 1) {
    return fetchNearbyPlaces(lat, lng, radius, category, signal)
  }

  console.log(`[API] Tiling large radius (${radius}m) into ${tiles.length} tiles`)

  const results = []
  const seen = new Set()

  // Fetch tiles in batches to limit concurrency
  for (let i = 0; i < tiles.length; i += MAX_CONCURRENT_TILES) {
    // Check for cancellation between batches
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const batch = tiles.slice(i, i + MAX_CONCURRENT_TILES)
    const batchResults = await Promise.all(
      batch.map(tile =>
        fetchNearbyPlaces(tile.lat, tile.lng, tile.radius, category, signal)
          .catch(err => {
            // Rethrow abort errors, swallow others
            if (err.name === 'AbortError') throw err
            console.warn(`Tile fetch failed:`, err)
            return []
          })
      )
    )

    // Deduplicate as we go
    for (const places of batchResults) {
      for (const place of places) {
        if (!seen.has(place.id)) {
          seen.add(place.id)
          results.push(place)
        }
      }
    }
  }

  console.log(`[API] Tiled fetch complete: ${results.length} unique places from ${tiles.length} tiles`)
  return results
}

/**
 * Fetch Wikipedia image for a place
 * @param {string} title - Wikipedia article title
 * @returns {Promise<string|null>} Image URL or null
 */
export async function fetchWikipediaImage(title) {
  try {
    const response = await fetch(
      `${WIKIPEDIA_API}/page/summary/${encodeURIComponent(title)}`
    )

    if (response.ok) {
      const data = await response.json()
      return data.thumbnail?.source || data.originalimage?.source || null
    }
  } catch (error) {
    console.warn('Wikipedia image fetch failed:', error)
  }
  return null
}

/**
 * Fetch image from Wikimedia Commons via Wikidata
 * @param {string} wikidataId - Wikidata ID (e.g., 'Q12345')
 * @returns {Promise<string|null>} Image URL or null
 */
export async function fetchWikidataImage(wikidataId) {
  try {
    const response = await fetch(
      `https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`
    )

    if (response.ok) {
      const data = await response.json()
      const entity = data.entities[wikidataId]
      const imageClaim = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value

      if (imageClaim) {
        // Convert filename to Commons URL
        const filename = imageClaim.replace(/ /g, '_')
        const hash = md5Hash(filename)
        return `https://upload.wikimedia.org/wikipedia/commons/${hash[0]}/${hash.substring(0,2)}/${filename}`
      }
    }
  } catch (error) {
    console.warn('Wikidata image fetch failed:', error)
  }
  return null
}

// Simple hash for Commons URLs (not cryptographic md5, just a placeholder)
function md5Hash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

/**
 * Reverse geocode coordinates to address
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<string|null>} Address or null
 */
export async function reverseGeocode(lat, lng) {
  try {
    const response = await fetch(
      `${NOMINATIM_API}/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`,
      { headers: { 'User-Agent': 'ROAM/1.0 (go-roam.uk)' } }
    )

    if (response.ok) {
      const data = await response.json()
      return data.display_name
    }
  } catch (error) {
    console.warn('Reverse geocode failed:', error)
  }
  return null
}

/**
 * Geocode address to coordinates
 * @param {string} address - Address string
 * @returns {Promise<{lat: number, lng: number}|null>}
 */
export async function geocodeAddress(address) {
  try {
    const response = await fetch(
      `${NOMINATIM_API}/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
      { headers: { 'User-Agent': 'ROAM/1.0 (go-roam.uk)' } }
    )

    if (response.ok) {
      const data = await response.json()
      if (data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon)
        }
      }
    }
  } catch (error) {
    console.warn('Geocode failed:', error)
  }
  return null
}

// In-memory weather cache (more aggressive than general cache)
const weatherCache = new Map()
const WEATHER_CACHE_TTL = 30 * 60 * 1000 // 30 minutes

/**
 * Fetch weather for location
 * Uses aggressive in-memory caching for fast repeated access
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<Object|null>} Weather data
 */
export async function fetchWeather(lat, lng) {
  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)}`

  // Check in-memory cache first
  const cached = weatherCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < WEATHER_CACHE_TTL) {
    return cached.data
  }

  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&timezone=auto`
    )

    if (response.ok) {
      const data = await response.json()
      const weather = {
        temperature: data.current.temperature_2m,
        weatherCode: data.current.weather_code,
        description: getWeatherDescription(data.current.weather_code)
      }

      // Cache the result
      weatherCache.set(cacheKey, { data: weather, timestamp: Date.now() })

      return weather
    }
  } catch (error) {
    console.warn('Weather fetch failed:', error)

    // Return stale cache on error
    if (cached) {
      return cached.data
    }
  }
  return null
}

/**
 * Get weather description from WMO code
 */
function getWeatherDescription(code) {
  const descriptions = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    71: 'Slight snow',
    73: 'Moderate snow',
    75: 'Heavy snow',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    95: 'Thunderstorm'
  }
  return descriptions[code] || 'Unknown'
}

// ═══════════════════════════════════════════════════════
// OPENTRIPMAP API - Tourist attractions with rich data
// ═══════════════════════════════════════════════════════

/**
 * Map OpenTripMap kinds to our category system
 */
const OTM_KIND_MAPPING = {
  // Nature
  'natural': 'nature',
  'beaches': 'nature',
  'gardens_and_parks': 'nature',
  'nature_reserves': 'nature',
  'geological_formations': 'nature',
  'water': 'nature',
  // Culture
  'museums': 'culture',
  'theatres_and_entertainments': 'culture',
  'cultural': 'culture',
  'art_galleries': 'culture',
  // Historic
  'historic': 'historic',
  'architecture': 'historic',
  'historic_architecture': 'historic',
  'castles': 'historic',
  'churches': 'historic',
  'monuments_and_memorials': 'historic',
  'archaeological': 'historic',
  // Food
  'foods': 'food',
  'restaurants': 'food',
  'cafes': 'food',
  'pubs': 'food',
  // Entertainment
  'amusements': 'entertainment',
  'sport': 'active',
  'accomodations': null, // Skip hotels
  'shops': 'shopping',
  'marketplaces': 'shopping',
  // Unique
  'interesting_places': 'unique',
  'view_points': 'unique',
  'lighthouses': 'unique',
}

/**
 * Fetch places from OpenTripMap by radius
 * Uses managed fetch for rate limiting and circuit breaker
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radius - Search radius in meters
 * @param {string|null} kinds - Comma-separated kinds filter
 * @returns {Promise<Array>} Array of places
 */
export async function fetchOpenTripMapPlaces(lat, lng, radius = 5000, kinds = null) {
  // Skip if no API key
  if (!OTM_API_KEY) {
    return []
  }

  // Check circuit breaker before making request
  if (isCircuitOpen('opentripmap')) {
    return []
  }

  const cacheKey = makeKey('otm', lat, lng, radius, kinds)

  const result = await managedFetch('opentripmap', cacheKey, async () => {
    let url = `${OPENTRIPMAP_API}/en/places/radius?lat=${lat}&lon=${lng}&radius=${radius}&limit=100&apikey=${OTM_API_KEY}`

    if (kinds) {
      url += `&kinds=${kinds}`
    }

    // Request places with at least some rating (filters out low-quality entries)
    url += '&rate=2'

    const response = await fetch(url)

    if (!response.ok) {
      // Create an error with status for circuit breaker to detect auth failures
      const error = new Error(`OpenTripMap request failed: ${response.status}`)
      error.status = response.status
      throw error
    }

    const data = await response.json()

    if (!Array.isArray(data)) return []

    return data.map(place => ({
      id: `otm_${place.xid}`,
      xid: place.xid,
      name: place.name,
      lat: place.point?.lat,
      lng: place.point?.lon,
      type: mapOtmKind(place.kinds),
      kinds: place.kinds,
      rating: place.rate,
      source: 'opentripmap'
    })).filter(p => p.name && p.lat && p.lng)
  }, { ttl: 10 * 60 * 1000 }) // 10 minute cache

  return result || []
}

/**
 * Map OTM kinds string to our category
 */
function mapOtmKind(kinds) {
  if (!kinds) return 'unique'
  const kindList = kinds.split(',')

  for (const kind of kindList) {
    const mapped = OTM_KIND_MAPPING[kind.trim()]
    if (mapped) return mapped
  }

  // Default mapping based on common patterns
  if (kinds.includes('historic')) return 'historic'
  if (kinds.includes('museum')) return 'culture'
  if (kinds.includes('natural') || kinds.includes('park')) return 'nature'
  if (kinds.includes('restaurant') || kinds.includes('food')) return 'food'

  return 'unique'
}

/**
 * Fetch detailed place info from OpenTripMap
 * Uses managed fetch for rate limiting and circuit breaker
 *
 * @param {string} xid - OpenTripMap place ID
 * @returns {Promise<Object|null>} Place details
 */
export async function fetchOpenTripMapDetails(xid) {
  // Skip if no API key or circuit is open
  if (!OTM_API_KEY || isCircuitOpen('opentripmap')) {
    return null
  }

  const cacheKey = makeKey('otm_detail', xid)

  const result = await managedFetch('opentripmap', cacheKey, async () => {
    const response = await fetch(
      `${OPENTRIPMAP_API}/en/places/xid/${xid}?apikey=${OTM_API_KEY}`
    )

    if (!response.ok) {
      const error = new Error(`OpenTripMap details failed: ${response.status}`)
      error.status = response.status
      throw error
    }

    const data = await response.json()

    return {
      name: data.name,
      description: data.wikipedia_extracts?.text || data.info?.descr || null,
      image: data.preview?.source || data.image || null,
      wikipedia: data.wikipedia || null,
      wikidata: data.wikidata || null,
      address: formatOtmAddress(data.address),
      website: data.url || null,
      kinds: data.kinds,
      rating: data.rate
    }
  }, { ttl: 30 * 60 * 1000 }) // 30 minute cache for details

  return result
}

/**
 * Format OpenTripMap address
 */
function formatOtmAddress(address) {
  if (!address) return null
  const parts = [
    address.house_number,
    address.road,
    address.city || address.town || address.village,
    address.postcode
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

// ═══════════════════════════════════════════════════════
// WIKIPEDIA API - Descriptions and images
// ═══════════════════════════════════════════════════════

/**
 * Fetch Wikipedia summary/extract for a place
 * @param {string} title - Wikipedia article title (can be from wikipedia tag like "en:Article Name")
 * @returns {Promise<Object|null>} Summary with extract and image
 */
export async function fetchWikipediaSummary(title) {
  try {
    // Handle "en:Article Name" format from OSM tags
    let articleTitle = title
    let lang = 'en'

    if (title.includes(':')) {
      const [langCode, ...rest] = title.split(':')
      if (langCode.length === 2) {
        lang = langCode
        articleTitle = rest.join(':')
      }
    }

    const apiBase = `https://${lang}.wikipedia.org/api/rest_v1`
    const response = await fetch(
      `${apiBase}/page/summary/${encodeURIComponent(articleTitle)}`
    )

    if (!response.ok) return null

    const data = await response.json()

    return {
      title: data.title,
      extract: data.extract,
      extractShort: data.extract ? truncateText(data.extract, 150) : null,
      image: data.thumbnail?.source || data.originalimage?.source || null,
      url: data.content_urls?.desktop?.page || null
    }
  } catch (error) {
    console.warn('Wikipedia summary fetch failed:', error)
    return null
  }
}

/**
 * Truncate text to a maximum length at word boundary
 */
function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text
  const truncated = text.substring(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  return (lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated) + '...'
}

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
 * For large radii (driving mode), we make multiple Wikipedia calls
 * to sample different areas within the search radius.
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radius - Search radius in meters
 * @param {string|null} category - Category key or null for all
 * @returns {Promise<Array>} Merged array of places
 */
export async function fetchEnrichedPlaces(lat, lng, radius = 5000, category = null) {
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

  // Use tiling for very large radii (>40km) to prevent timeouts
  const usesTiling = radius > 40000
  const osmFetcher = usesTiling
    ? fetchWithTiling(lat, lng, radius, category).catch(err => {
        console.warn('OSM tiled fetch failed:', err)
        return []
      })
    : fetchNearbyPlaces(lat, lng, radius, category).catch(err => {
        console.warn('OSM fetch failed:', err)
        return []
      })

  // Fetch from ALL sources in parallel with individual failure handling
  const [osmPlaces, otmPlaces, ...wikiResults] = await Promise.all([
    osmFetcher,
    fetchOpenTripMapPlaces(lat, lng, radius).catch(err => {
      console.warn('OpenTripMap fetch failed:', err)
      return []
    }),
    ...wikiPromises
  ])

  // Merge all wiki results
  const wikiPlaces = wikiResults.flat()

  // Log source counts for debugging
  console.log(`[API] Sources: OSM=${osmPlaces.length}, OTM=${otmPlaces.length}, Wiki=${wikiPlaces.length}`)

  // If all sources returned empty for large radius, log a warning
  if (isLargeRadius && osmPlaces.length === 0 && otmPlaces.length === 0 && wikiPlaces.length === 0) {
    console.warn(`[API] No places found for large radius (${radius}m) at ${lat}, ${lng}`)
  }

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
export async function fetchPlacesWithSWR(lat, lng, radius = 5000, category = null, onRefresh = null) {
  const cacheKey = makeCacheKey(lat, lng, radius, category)

  return getWithSWR(
    cacheKey,
    () => fetchEnrichedPlaces(lat, lng, radius, category),
    {
      ttl: 10 * 60 * 1000, // 10 minute freshness
      onBackgroundRefresh: onRefresh
    }
  )
}

/**
 * Enrich a single place with additional data (Wikipedia, OTM details)
 * Call this for places shown in detail view, not for list view
 * @param {Object} place - Place object
 * @returns {Promise<Object>} Enriched place
 */
export async function enrichPlace(place) {
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

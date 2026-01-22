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
import { managedFetch, isCircuitOpen } from './requestManager'
import { makeCacheKey, makeKey } from './geoCache'
import { selectBestImage } from './imageScoring'

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
 * Expanded to include more UK-relevant OSM tags
 */
function buildOverpassQuery(lat, lng, radius, types) {
  const typeFilters = types.map(type =>
    `node["amenity"="${type}"](around:${radius},${lat},${lng});
     way["amenity"="${type}"](around:${radius},${lat},${lng});
     node["tourism"="${type}"](around:${radius},${lat},${lng});
     way["tourism"="${type}"](around:${radius},${lat},${lng});
     node["leisure"="${type}"](around:${radius},${lat},${lng});
     way["leisure"="${type}"](around:${radius},${lat},${lng});
     node["historic"="${type}"](around:${radius},${lat},${lng});
     way["historic"="${type}"](around:${radius},${lat},${lng});
     node["shop"="${type}"](around:${radius},${lat},${lng});
     way["shop"="${type}"](around:${radius},${lat},${lng});
     node["natural"="${type}"](around:${radius},${lat},${lng});
     way["natural"="${type}"](around:${radius},${lat},${lng});
     node["man_made"="${type}"](around:${radius},${lat},${lng});
     way["man_made"="${type}"](around:${radius},${lat},${lng});
     node["landuse"="${type}"](around:${radius},${lat},${lng});
     way["landuse"="${type}"](around:${radius},${lat},${lng});`
  ).join('\n')

  return `
    [out:json][timeout:30];
    (
      ${typeFilters}
    );
    out body center;
  `
}

/**
 * Fetch places from Overpass API with fallback
 */
async function fetchFromOverpass(query) {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`
      })

      if (response.ok) {
        return await response.json()
      }
    } catch (error) {
      console.warn(`Overpass endpoint failed: ${endpoint}`, error)
    }
  }
  throw new Error('All Overpass endpoints failed')
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
      designation: tags.designation
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
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radius - Search radius in meters
 * @param {string|null} category - Category key or null for all
 * @returns {Promise<Array>} Array of places
 */
export async function fetchNearbyPlaces(lat, lng, radius = 5000, category = null) {
  const cacheKey = makeCacheKey(lat, lng, radius, category)

  const result = await managedFetch('overpass', cacheKey, async () => {
    const types = category ? getTypesForCategory(category) : getAllGoodTypes()

    // Limit types per query to avoid timeout (increased for more variety)
    const limitedTypes = types.slice(0, 35)

    const query = buildOverpassQuery(lat, lng, radius, limitedTypes)
    const data = await fetchFromOverpass(query)

    return parseOverpassResponse(data)
  }, { ttl: 10 * 60 * 1000 }) // 10 minute cache

  return result || []
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

/**
 * Fetch weather for location
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<Object|null>} Weather data
 */
export async function fetchWeather(lat, lng) {
  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&timezone=auto`
    )

    if (response.ok) {
      const data = await response.json()
      return {
        temperature: data.current.temperature_2m,
        weatherCode: data.current.weather_code,
        description: getWeatherDescription(data.current.weather_code)
      }
    }
  } catch (error) {
    console.warn('Weather fetch failed:', error)
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
 * - Wikipedia Geosearch (notable/famous places)
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radius - Search radius in meters
 * @param {string|null} category - Category key or null for all
 * @returns {Promise<Array>} Merged array of places
 */
export async function fetchEnrichedPlaces(lat, lng, radius = 5000, category = null) {
  // Fetch from ALL sources in parallel with individual failure handling
  const [osmPlaces, otmPlaces, wikiPlaces] = await Promise.all([
    fetchNearbyPlaces(lat, lng, radius, category).catch(err => {
      console.warn('OSM fetch failed:', err)
      return []
    }),
    fetchOpenTripMapPlaces(lat, lng, radius).catch(err => {
      console.warn('OpenTripMap fetch failed:', err)
      return []
    }),
    fetchWikipediaPlaces(lat, lng, radius).catch(err => {
      console.warn('Wikipedia geosearch failed:', err)
      return []
    })
  ])

  // Log source counts for debugging
  console.log(`[API] Sources: OSM=${osmPlaces.length}, OTM=${otmPlaces.length}, Wiki=${wikiPlaces.length}`)

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

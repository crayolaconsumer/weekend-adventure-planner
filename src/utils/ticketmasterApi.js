/**
 * Ticketmaster Discovery API Integration
 *
 * Uses Vercel serverless proxy to keep API key secure.
 * Free tier: 5,000 requests/day, 5 requests/second
 * Docs: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
 */

import {
  validateCoordinates,
  validateRadius,
  canMakeRequest,
  recordSuccess,
  recordFailure,
  deduplicateRequest,
  fetchWithTimeout
} from './apiProtection'

const API_NAME = 'ticketmaster'
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes

// In-memory cache
let tmCache = {
  data: null,
  location: null,
  timestamp: 0
}

/**
 * Fetch a single page of events from Ticketmaster
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radiusKm - Search radius in km
 * @param {number} page - Page number (0-indexed)
 * @returns {Promise<{events: Array, pagination: Object|null}>}
 */
async function fetchTicketmasterPage(lat, lng, radiusKm, page) {
  const params = new URLSearchParams({
    lat: lat.toString(),
    lng: lng.toString(),
    radius: radiusKm.toString(),
    page: page.toString()
  })

  const response = await fetchWithTimeout(`/api/events/ticketmaster?${params}`)

  if (!response.ok) {
    return { events: [], pagination: null }
  }

  const data = await response.json()
  const events = (data.events || [])
    .map(normalizeTicketmasterEvent)
    .filter(Boolean)

  return {
    events,
    pagination: data.pagination || null
  }
}

/**
 * Fetch events from Ticketmaster via secure server-side proxy
 * Fetches multiple pages in parallel for better coverage
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radiusKm - Search radius in km (default 30)
 * @param {Object} options - Fetch options
 * @param {number} options.pagesToFetch - Number of pages to fetch in parallel (default 3)
 * @param {number} options.startPage - Starting page number (default 0)
 * @returns {Promise<{events: RoamEvent[], pagination: Object|null}>}
 */
export async function fetchTicketmasterEvents(lat, lng, radiusKm = 30, options = {}) {
  const { pagesToFetch = 3, startPage = 0 } = options

  // Validate inputs
  const coordCheck = validateCoordinates(lat, lng)
  if (!coordCheck.valid) {
    console.error('Ticketmaster:', coordCheck.error)
    return { events: [], pagination: null }
  }

  const radiusCheck = validateRadius(radiusKm)
  if (!radiusCheck.valid) {
    console.error('Ticketmaster:', radiusCheck.error)
    return { events: [], pagination: null }
  }

  // Check circuit breaker before proceeding
  if (!canMakeRequest(API_NAME)) {
    console.warn('Ticketmaster API circuit breaker open, using cached data')
    return { events: tmCache.data?.events || [], pagination: tmCache.data?.pagination || null }
  }

  // Check cache validity (only for initial load, startPage === 0)
  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)},${radiusKm}`
  if (
    startPage === 0 &&
    tmCache.data &&
    tmCache.location === cacheKey &&
    Date.now() - tmCache.timestamp < CACHE_TTL
  ) {
    return tmCache.data
  }

  // Deduplicate requests - return existing promise if same request in flight
  const requestKey = `tm_${cacheKey}_${startPage}_${pagesToFetch}`

  return deduplicateRequest(requestKey, async () => {
    try {
      // Fetch multiple pages in parallel
      const pagePromises = Array.from({ length: pagesToFetch }, (_, i) =>
        fetchTicketmasterPage(lat, lng, radiusKm, startPage + i)
      )

      const results = await Promise.allSettled(pagePromises)

      // Combine events from all successful page fetches
      const allEvents = []
      let firstPagination = null

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.events.length > 0) {
          allEvents.push(...result.value.events)
          // Use pagination from first successful response
          if (!firstPagination && result.value.pagination) {
            firstPagination = result.value.pagination
          }
        }
      }

      // Deduplicate events by ID (same event shouldn't appear twice)
      const seenIds = new Set()
      const uniqueEvents = allEvents.filter(event => {
        if (seenIds.has(event.id)) return false
        seenIds.add(event.id)
        return true
      })

      const responseData = {
        events: uniqueEvents,
        pagination: firstPagination
      }

      // Update cache only for initial load
      if (startPage === 0) {
        tmCache = {
          data: responseData,
          location: cacheKey,
          timestamp: Date.now()
        }
      }

      recordSuccess(API_NAME)
      return responseData
    } catch {
      recordFailure(API_NAME)
      return { events: tmCache.data?.events || [], pagination: tmCache.data?.pagination || null }
    }
  })
}

/**
 * Normalize Ticketmaster event to ROAM format
 */
function normalizeTicketmasterEvent(event) {
  if (!event || !event.id) return null

  const venue = event._embedded?.venues?.[0] || {}
  const priceRange = event.priceRanges?.[0]
  const startDate = event.dates?.start
  const endDate = event.dates?.end

  // Get image - prefer 16:9 ratio, fallback to any
  const image = event.images?.find(img => img.ratio === '16_9' && img.width >= 640)
    || event.images?.[0]

  return {
    id: `tm_${event.id}`,
    source: 'ticketmaster',
    name: event.name || 'Untitled Event',
    description: truncateText(event.info || event.pleaseNote || '', 150),
    imageUrl: image?.url || null,

    venue: {
      name: venue.name || 'Venue TBA',
      lat: parseFloat(venue.location?.latitude) || null,
      lng: parseFloat(venue.location?.longitude) || null,
      address: formatTicketmasterAddress(venue)
    },

    datetime: {
      start: startDate?.dateTime ? new Date(startDate.dateTime) :
             startDate?.localDate ? new Date(startDate.localDate) : null,
      end: endDate?.dateTime ? new Date(endDate.dateTime) : null,
      timezone: startDate?.timezone || 'Europe/London',
      isMultiDay: false,
      localTime: startDate?.localTime || null,
      tba: startDate?.timeTBA || false
    },

    pricing: {
      isFree: false,
      minPrice: priceRange?.min || null,
      maxPrice: priceRange?.max || null,
      currency: priceRange?.currency || 'GBP'
    },

    categories: extractTicketmasterCategories(event),
    ticketUrl: event.url,
    isSoldOut: event.dates?.status?.code === 'offsale',
    isOnline: false,

    // Extra Ticketmaster data
    genre: event.classifications?.[0]?.genre?.name,
    segment: event.classifications?.[0]?.segment?.name
  }
}

/**
 * Format Ticketmaster venue address
 */
function formatTicketmasterAddress(venue) {
  if (!venue) return null

  const parts = [
    venue.address?.line1,
    venue.city?.name,
    venue.postalCode
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Extract categories from Ticketmaster classifications
 */
function extractTicketmasterCategories(event) {
  const categories = []
  const classification = event.classifications?.[0]

  if (classification?.segment?.name) {
    categories.push(mapTicketmasterCategory(classification.segment.name))
  }
  if (classification?.genre?.name) {
    categories.push(classification.genre.name.toLowerCase())
  }

  return categories.filter(Boolean)
}

/**
 * Map Ticketmaster segments to ROAM categories
 */
function mapTicketmasterCategory(segment) {
  const mapping = {
    'Music': 'music',
    'Sports': 'active',
    'Arts & Theatre': 'culture',
    'Film': 'entertainment',
    'Miscellaneous': 'unique',
    'Comedy': 'entertainment',
    'Family': 'family'
  }

  return mapping[segment] || segment?.toLowerCase()
}

/**
 * Truncate text to max length
 */
function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text
  return text.slice(0, maxLength).trim() + '...'
}

export default {
  fetchTicketmasterEvents
}

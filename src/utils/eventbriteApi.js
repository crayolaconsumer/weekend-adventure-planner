/**
 * Eventbrite API Integration
 *
 * Uses Vercel serverless proxy to keep API token secure.
 * Note: Eventbrite deprecated their public search API in 2023.
 * This integration may not return results without Destination API access.
 *
 * Fetches local events from Eventbrite and normalizes them
 * for display in the ROAM discovery feed.
 */

import {
  validateCoordinates,
  canMakeRequest,
  recordSuccess,
  recordFailure,
  deduplicateRequest,
  fetchWithTimeout
} from './apiProtection'

const API_NAME = 'eventbrite'
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes

// In-memory cache
let eventsCache = {
  data: null,
  location: null,
  timestamp: 0
}

/**
 * Normalized event structure
 * @typedef {Object} RoamEvent
 * @property {string} id - Unique event ID
 * @property {string} source - 'eventbrite'
 * @property {string} name - Event name
 * @property {string} description - Short description
 * @property {string} imageUrl - Event image
 * @property {Object} venue - Venue details
 * @property {Object} datetime - Start/end times
 * @property {Object} pricing - Ticket pricing
 * @property {string[]} categories - Event categories
 * @property {string} ticketUrl - Link to purchase tickets
 * @property {boolean} isSoldOut - Whether event is sold out
 * @property {boolean} isOnline - Whether event is online-only
 */

/**
 * Fetch events from Eventbrite via secure server-side proxy
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radiusKm - Search radius in km (default 15)
 * @returns {Promise<RoamEvent[]>}
 */
export async function fetchEvents(lat, lng, radiusKm = 15) {
  // Validate inputs
  const coordCheck = validateCoordinates(lat, lng)
  if (!coordCheck.valid) {
    console.error('Eventbrite:', coordCheck.error)
    return []
  }

  // Check circuit breaker
  if (!canMakeRequest(API_NAME)) {
    console.warn('Eventbrite API circuit breaker open, using cached data')
    return eventsCache.data || []
  }

  // Check cache validity
  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)}`
  if (
    eventsCache.data &&
    eventsCache.location === cacheKey &&
    Date.now() - eventsCache.timestamp < CACHE_TTL
  ) {
    return eventsCache.data
  }

  // Deduplicate requests
  const requestKey = `eb_${cacheKey}_${radiusKm}`

  return deduplicateRequest(requestKey, async () => {
    try {
      // Call secure server-side proxy (API token handled server-side)
      const params = new URLSearchParams({
        lat: lat.toString(),
        lng: lng.toString(),
        radius: radiusKm.toString()
      })

      const response = await fetchWithTimeout(`/api/events/eventbrite?${params}`)

      if (!response.ok) {
        if (response.status === 404) {
          // The search endpoint was deprecated - don't count as failure
          console.warn('Eventbrite search API deprecated. Events feature requires Destination API access.')
        } else if (response.status === 429) {
          console.warn('Eventbrite API: Rate limited')
          recordFailure(API_NAME)
        } else if (response.status === 500) {
          const errorData = await response.json().catch(() => ({}))
          console.error('Eventbrite proxy error:', errorData.error || response.status)
          recordFailure(API_NAME)
        } else {
          console.error('Eventbrite API error:', response.status)
          recordFailure(API_NAME)
        }
        return eventsCache.data || []
      }

      const data = await response.json()
      const events = (data.events || []).map(normalizeEvent).filter(Boolean)

      // Update cache
      eventsCache = {
        data: events,
        location: cacheKey,
        timestamp: Date.now()
      }

      recordSuccess(API_NAME)
      return events
    } catch (error) {
      console.error('Eventbrite fetch error:', error.message)
      recordFailure(API_NAME)
      return eventsCache.data || []
    }
  })
}

/**
 * Normalize Eventbrite event to ROAM format
 * @param {Object} event - Raw Eventbrite event
 * @returns {RoamEvent|null}
 */
function normalizeEvent(event) {
  if (!event || !event.id) return null

  // Skip online-only events for a local discovery app
  if (event.online_event && !event.venue) {
    return null
  }

  const venue = event.venue || {}
  const ticketAvail = event.ticket_availability || {}

  return {
    id: `eb_${event.id}`,
    source: 'eventbrite',
    name: event.name?.text || 'Untitled Event',
    description: truncateText(event.description?.text || event.summary || '', 150),
    imageUrl: event.logo?.url || event.logo?.original?.url || null,

    venue: {
      name: venue.name || 'Venue TBA',
      lat: parseFloat(venue.latitude) || null,
      lng: parseFloat(venue.longitude) || null,
      address: formatVenueAddress(venue)
    },

    datetime: {
      start: event.start?.utc ? new Date(event.start.utc) : null,
      end: event.end?.utc ? new Date(event.end.utc) : null,
      timezone: event.start?.timezone || 'Europe/London',
      isMultiDay: isMultiDayEvent(event.start?.utc, event.end?.utc)
    },

    pricing: {
      isFree: event.is_free || false,
      minPrice: ticketAvail.minimum_ticket_price?.major_value || null,
      maxPrice: ticketAvail.maximum_ticket_price?.major_value || null,
      currency: ticketAvail.minimum_ticket_price?.currency || 'GBP'
    },

    categories: extractCategories(event),
    ticketUrl: event.url,
    isSoldOut: ticketAvail.is_sold_out || false,
    isOnline: event.online_event || false
  }
}

/**
 * Format venue address
 */
function formatVenueAddress(venue) {
  if (!venue) return null

  const parts = [
    venue.address?.address_1,
    venue.address?.city,
    venue.address?.postal_code
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Extract category names from event
 */
function extractCategories(event) {
  const categories = []

  if (event.category) {
    categories.push(event.category.name?.toLowerCase())
  }

  if (event.subcategory) {
    categories.push(event.subcategory.name?.toLowerCase())
  }

  // Map to ROAM-friendly category names
  return categories
    .filter(Boolean)
    .map(cat => mapEventCategory(cat))
    .filter(Boolean)
}

/**
 * Map Eventbrite categories to ROAM categories
 */
function mapEventCategory(category) {
  const mapping = {
    'music': 'music',
    'food & drink': 'food',
    'performing & visual arts': 'culture',
    'film, media & entertainment': 'entertainment',
    'health & wellness': 'active',
    'sports & fitness': 'active',
    'travel & outdoor': 'nature',
    'business & professional': 'other',
    'science & technology': 'other',
    'charity & causes': 'other',
    'community & culture': 'culture',
    'family & education': 'family',
    'fashion & beauty': 'shopping',
    'home & lifestyle': 'other',
    'hobbies & special interest': 'unique',
    'seasonal & holiday': 'unique'
  }

  return mapping[category] || category
}

/**
 * Check if event spans multiple days
 */
function isMultiDayEvent(startUtc, endUtc) {
  if (!startUtc || !endUtc) return false

  const start = new Date(startUtc)
  const end = new Date(endUtc)

  return start.toDateString() !== end.toDateString()
}

/**
 * Truncate text to max length
 */
function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text
  return text.slice(0, maxLength).trim() + '...'
}

/**
 * Format event date for display
 * @param {Date} date
 * @param {boolean} includeTime
 * @returns {string}
 */
export function formatEventDate(date, includeTime = true) {
  if (!date) return 'Date TBA'

  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const isToday = date.toDateString() === now.toDateString()
  const isTomorrow = date.toDateString() === tomorrow.toDateString()

  let dateStr
  if (isToday) {
    dateStr = 'Today'
  } else if (isTomorrow) {
    dateStr = 'Tomorrow'
  } else {
    dateStr = date.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    })
  }

  if (includeTime) {
    const timeStr = date.toLocaleTimeString('en-GB', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).replace(':00', '')

    return `${dateStr}, ${timeStr}`
  }

  return dateStr
}

/**
 * Format price range for display
 * @param {Object} pricing
 * @returns {string}
 */
export function formatPriceRange(pricing) {
  if (!pricing) return ''

  if (pricing.isFree) {
    return 'Free'
  }

  if (pricing.minPrice === null) {
    return 'Check price'
  }

  const symbol = pricing.currency === 'GBP' ? '£' : pricing.currency

  if (pricing.minPrice === pricing.maxPrice) {
    return `${symbol}${pricing.minPrice}`
  }

  if (pricing.maxPrice) {
    return `${symbol}${pricing.minPrice} - ${symbol}${pricing.maxPrice}`
  }

  return `From ${symbol}${pricing.minPrice}`
}

/**
 * Get events happening today
 * @param {RoamEvent[]} events
 * @returns {RoamEvent[]}
 */
export function getTodayEvents(events) {
  const today = new Date().toDateString()
  return events.filter(e => e.datetime.start?.toDateString() === today)
}

/**
 * Get events happening this weekend
 * @param {RoamEvent[]} events
 * @returns {RoamEvent[]}
 */
export function getWeekendEvents(events) {
  const now = new Date()
  const dayOfWeek = now.getDay()

  // Get Saturday and Sunday of this week
  const saturday = new Date(now)
  saturday.setDate(now.getDate() + (6 - dayOfWeek))
  saturday.setHours(0, 0, 0, 0)

  const sunday = new Date(saturday)
  sunday.setDate(saturday.getDate() + 1)

  const mondayAfter = new Date(sunday)
  mondayAfter.setDate(sunday.getDate() + 1)
  mondayAfter.setHours(0, 0, 0, 0)

  return events.filter(e => {
    const start = e.datetime.start
    return start && start >= saturday && start < mondayAfter
  })
}

/**
 * Get free events only
 * @param {RoamEvent[]} events
 * @returns {RoamEvent[]}
 */
export function getFreeEvents(events) {
  return events.filter(e => e.pricing.isFree)
}

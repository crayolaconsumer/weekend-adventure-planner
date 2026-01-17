/**
 * Skiddle Events API Integration
 *
 * Uses Vercel serverless proxy to keep API key secure.
 * UK-focused events platform - clubs, festivals, nightlife
 * Free API key: https://www.skiddle.com/api/join.php
 * Docs: https://github.com/Skiddle/web-api
 */

import {
  validateCoordinates,
  canMakeRequest,
  recordSuccess,
  recordFailure,
  deduplicateRequest,
  fetchWithTimeout
} from './apiProtection'

const API_NAME = 'skiddle'
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes

// In-memory cache
let skiddleCache = {
  data: null,
  location: null,
  timestamp: 0
}

/**
 * Fetch events from Skiddle via secure server-side proxy
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radiusMiles - Search radius in miles (default 20)
 * @returns {Promise<RoamEvent[]>}
 */
export async function fetchSkiddleEvents(lat, lng, radiusMiles = 20) {
  // Validate inputs
  const coordCheck = validateCoordinates(lat, lng)
  if (!coordCheck.valid) {
    console.error('Skiddle:', coordCheck.error)
    return []
  }

  // Clamp radius to reasonable bounds (1-100 miles)
  const clampedRadius = Math.max(1, Math.min(100, radiusMiles))

  // Check circuit breaker before proceeding
  if (!canMakeRequest(API_NAME)) {
    console.warn('Skiddle API circuit breaker open, using cached data')
    return skiddleCache.data || []
  }

  // Check cache validity
  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)}`
  if (
    skiddleCache.data &&
    skiddleCache.location === cacheKey &&
    Date.now() - skiddleCache.timestamp < CACHE_TTL
  ) {
    return skiddleCache.data
  }

  // Deduplicate requests
  const requestKey = `sk_${cacheKey}_${clampedRadius}`

  return deduplicateRequest(requestKey, async () => {
    try {
      // Call secure server-side proxy (API key handled server-side)
      const params = new URLSearchParams({
        lat: lat.toString(),
        lng: lng.toString(),
        radius: clampedRadius.toString()
      })

      const response = await fetchWithTimeout(`/api/events/skiddle?${params}`)

      if (!response.ok) {
        if (response.status === 429) {
          console.warn('Skiddle API: Rate limited')
        } else if (response.status === 500) {
          const errorData = await response.json().catch(() => ({}))
          console.error('Skiddle proxy error:', errorData.error || response.status)
        } else {
          console.error('Skiddle API error:', response.status)
        }
        return skiddleCache.data || []
      }

      const data = await response.json()

      if (data.error) {
        console.error('Skiddle API error:', data.error)
        recordFailure(API_NAME)
        return skiddleCache.data || []
      }

      const events = (data.results || [])
        .map(normalizeSkiddleEvent)
        .filter(Boolean)

      // Update cache
      skiddleCache = {
        data: events,
        location: cacheKey,
        timestamp: Date.now()
      }

      recordSuccess(API_NAME)
      return events
    } catch (error) {
      console.error('Skiddle fetch error:', error.message)
      recordFailure(API_NAME)
      return skiddleCache.data || []
    }
  })
}

/**
 * Normalize Skiddle event to ROAM format
 */
function normalizeSkiddleEvent(event) {
  if (!event || !event.id) return null

  const venue = event.venue || {}

  // Parse date and time
  let startDate = null
  if (event.date) {
    const dateStr = event.openingtimes?.doorsopen
      ? `${event.date}T${event.openingtimes.doorsopen}`
      : event.date
    startDate = new Date(dateStr)
  }

  let endDate = null
  if (event.date && event.openingtimes?.doorsclose) {
    endDate = new Date(`${event.date}T${event.openingtimes.doorsclose}`)
    // Handle events that end after midnight
    if (endDate < startDate) {
      endDate.setDate(endDate.getDate() + 1)
    }
  }

  // Get best image
  const imageUrl = event.largeimageurl || event.imageurl || event.xlargeimageurl || null

  return {
    id: `sk_${event.id}`,
    source: 'skiddle',
    name: event.eventname || 'Untitled Event',
    description: truncateText(event.description || '', 150),
    imageUrl,

    venue: {
      name: venue.name || 'Venue TBA',
      lat: parseFloat(venue.latitude) || null,
      lng: parseFloat(venue.longitude) || null,
      address: formatSkiddleAddress(venue)
    },

    datetime: {
      start: startDate,
      end: endDate,
      timezone: 'Europe/London',
      isMultiDay: false,
      doorsOpen: event.openingtimes?.doorsopen || null,
      lastEntry: event.openingtimes?.lastentry || null
    },

    pricing: {
      isFree: event.entryprice === '0' || event.entryprice === 'Free',
      minPrice: parseFloat(event.entryprice) || null,
      maxPrice: null,
      currency: 'GBP'
    },

    categories: [mapSkiddleEventCode(event.EventCode)].filter(Boolean),
    ticketUrl: event.link,
    isSoldOut: false,
    isOnline: false,

    // Extra Skiddle data
    eventCode: event.EventCode,
    minAge: event.minage || null,
    goingCount: event.goingcount || 0,
    artists: event.artists || []
  }
}

/**
 * Format Skiddle venue address
 */
function formatSkiddleAddress(venue) {
  if (!venue) return null

  const parts = [
    venue.address,
    venue.town,
    venue.postcode
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Map Skiddle event codes to ROAM categories
 */
function mapSkiddleEventCode(eventCode) {
  const mapping = {
    'FEST': 'music',
    'LIVE': 'music',
    'CLUB': 'nightlife',
    'THEATRE': 'culture',
    'COMEDY': 'entertainment',
    'BARPUB': 'food',
    'EXHIB': 'culture',
    'SPORT': 'active',
    'KIDS': 'family',
    'DATING': 'unique'
  }

  return mapping[eventCode] || 'entertainment'
}

/**
 * Truncate text to max length
 */
function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text
  // Strip HTML tags
  const cleanText = text.replace(/<[^>]*>/g, '')
  if (cleanText.length <= maxLength) return cleanText
  return cleanText.slice(0, maxLength).trim() + '...'
}

/**
 * Get date plus N weeks
 */
function getDatePlusWeeks(weeks) {
  const date = new Date()
  date.setDate(date.getDate() + weeks * 7)
  return date
}

export default {
  fetchSkiddleEvents
}

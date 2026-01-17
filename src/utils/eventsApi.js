/**
 * Unified Events API
 *
 * Aggregates events from multiple sources:
 * - Ticketmaster (concerts, sports, theatre)
 * - Skiddle (UK clubs, festivals, nightlife)
 * - Eventbrite (local community events)
 *
 * Each source requires its own API key in .env.local
 */

import { fetchTicketmasterEvents } from './ticketmasterApi'
import { fetchSkiddleEvents } from './skiddleApi'
import { fetchEvents as fetchEventbriteEvents } from './eventbriteApi'

const COMBINED_CACHE_TTL = 15 * 60 * 1000 // 15 minutes

let combinedCache = {
  data: null,
  location: null,
  timestamp: 0
}

/**
 * Fetch events from all available sources
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radiusKm - Search radius in km
 * @returns {Promise<RoamEvent[]>}
 */
export async function fetchAllEvents(lat, lng, radiusKm = 30) {
  // Check cache validity
  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)},${radiusKm}`
  if (
    combinedCache.data &&
    combinedCache.location === cacheKey &&
    Date.now() - combinedCache.timestamp < COMBINED_CACHE_TTL
  ) {
    return combinedCache.data
  }

  // Fetch from all sources in parallel
  const [ticketmasterEvents, skiddleEvents, eventbriteEvents] = await Promise.allSettled([
    fetchTicketmasterEvents(lat, lng, radiusKm),
    fetchSkiddleEvents(lat, lng, Math.round(radiusKm * 0.621371)), // Convert to miles
    fetchEventbriteEvents(lat, lng, radiusKm)
  ])

  // Combine results, handling rejected promises
  const allEvents = [
    ...(ticketmasterEvents.status === 'fulfilled' ? ticketmasterEvents.value : []),
    ...(skiddleEvents.status === 'fulfilled' ? skiddleEvents.value : []),
    ...(eventbriteEvents.status === 'fulfilled' ? eventbriteEvents.value : [])
  ]

  // Deduplicate by name + date (same event might be on multiple platforms)
  const dedupedEvents = deduplicateEvents(allEvents)

  // Sort by start date
  const sortedEvents = dedupedEvents.sort((a, b) => {
    const dateA = a.datetime?.start || new Date(9999, 11, 31)
    const dateB = b.datetime?.start || new Date(9999, 11, 31)
    return dateA - dateB
  })

  // Update cache
  combinedCache = {
    data: sortedEvents,
    location: cacheKey,
    timestamp: Date.now()
  }

  return sortedEvents
}

/**
 * Deduplicate events that appear on multiple platforms
 * Prefers Ticketmaster > Skiddle > Eventbrite for data quality
 */
function deduplicateEvents(events) {
  const seen = new Map()
  const sourceRank = { ticketmaster: 1, skiddle: 2, eventbrite: 3 }

  for (const event of events) {
    // Create dedup key from normalized name + date
    const name = event.name.toLowerCase().replace(/[^a-z0-9]/g, '')
    const date = event.datetime?.start?.toDateString() || 'nodate'
    const key = `${name}_${date}`

    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, event)
    } else {
      // Keep the higher-ranked source
      const existingRank = sourceRank[existing.source] || 99
      const newRank = sourceRank[event.source] || 99
      if (newRank < existingRank) {
        seen.set(key, event)
      }
    }
  }

  return Array.from(seen.values())
}

/**
 * Get events happening today
 */
export function getTodayEvents(events) {
  const today = new Date().toDateString()
  return events.filter(e => e.datetime?.start?.toDateString() === today)
}

/**
 * Get events happening this weekend
 */
export function getWeekendEvents(events) {
  const now = new Date()
  const dayOfWeek = now.getDay()

  // Get Saturday and Sunday of this week
  const saturday = new Date(now)
  saturday.setDate(now.getDate() + (6 - dayOfWeek))
  saturday.setHours(0, 0, 0, 0)

  const mondayAfter = new Date(saturday)
  mondayAfter.setDate(saturday.getDate() + 2)
  mondayAfter.setHours(0, 0, 0, 0)

  return events.filter(e => {
    const start = e.datetime?.start
    return start && start >= saturday && start < mondayAfter
  })
}

/**
 * Get free events only
 */
export function getFreeEvents(events) {
  return events.filter(e => e.pricing?.isFree)
}

/**
 * Get events by category
 */
export function getEventsByCategory(events, category) {
  return events.filter(e =>
    e.categories?.some(c => c.toLowerCase() === category.toLowerCase())
  )
}

/**
 * Format event date for display
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
 */
export function formatPriceRange(pricing) {
  if (!pricing) return ''

  if (pricing.isFree) {
    return 'Free'
  }

  if (pricing.minPrice === null) {
    return 'Check price'
  }

  const symbol = pricing.currency === 'GBP' ? '£' :
                 pricing.currency === 'USD' ? '$' :
                 pricing.currency === 'EUR' ? '€' : pricing.currency

  if (pricing.minPrice === pricing.maxPrice || !pricing.maxPrice) {
    return `${symbol}${pricing.minPrice}`
  }

  return `${symbol}${pricing.minPrice} - ${symbol}${pricing.maxPrice}`
}

/**
 * Get source display name and color
 */
export function getSourceInfo(source) {
  const sources = {
    ticketmaster: { name: 'Ticketmaster', color: '#026CDF' },
    skiddle: { name: 'Skiddle', color: '#FF5500' },
    eventbrite: { name: 'Eventbrite', color: '#F05537' }
  }
  return sources[source] || { name: source, color: '#666' }
}

export default {
  fetchAllEvents,
  getTodayEvents,
  getWeekendEvents,
  getFreeEvents,
  getEventsByCategory,
  formatEventDate,
  formatPriceRange,
  getSourceInfo
}

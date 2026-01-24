/**
 * Unified Events API
 *
 * Aggregates events from multiple sources:
 * - Ticketmaster (concerts, sports, theatre)
 * - Skiddle (UK clubs, festivals, nightlife)
 *
 * Each source requires its own API key in .env.local
 */

import { fetchTicketmasterEvents } from './ticketmasterApi'
import { fetchSkiddleEvents } from './skiddleApi'

const COMBINED_CACHE_TTL = 15 * 60 * 1000 // 15 minutes
const PAST_EVENT_GRACE_HOURS = 6

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
 * @param {Object} options - Fetch options
 * @param {number} options.pagesToFetch - Number of Ticketmaster pages to fetch (default 3)
 * @param {number} options.startPage - Starting page for Ticketmaster (default 0)
 * @returns {Promise<{events: RoamEvent[], hasMore: boolean, totalAvailable: number, currentPage: number}>}
 */
export async function fetchAllEvents(lat, lng, radiusKm = 30, options = {}) {
  const { pagesToFetch = 3, startPage = 0 } = options

  // Check cache validity (only for initial load)
  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)},${radiusKm}`
  if (
    startPage === 0 &&
    combinedCache.data &&
    combinedCache.location === cacheKey &&
    Date.now() - combinedCache.timestamp < COMBINED_CACHE_TTL
  ) {
    return combinedCache.data
  }

  // Fetch from all sources in parallel
  const [ticketmasterResult, skiddleResult] = await Promise.allSettled([
    fetchTicketmasterEvents(lat, lng, radiusKm, { pagesToFetch, startPage }),
    fetchSkiddleEvents(lat, lng, Math.round(radiusKm * 0.621371)) // Convert to miles
  ])

  // Extract events from new response format
  const tmData = ticketmasterResult.status === 'fulfilled' ? ticketmasterResult.value : { events: [], pagination: null }
  const skiddleEvents = skiddleResult.status === 'fulfilled' ? skiddleResult.value : []

  // Combine results
  const allEvents = [
    ...tmData.events,
    ...skiddleEvents
  ]

  // Deduplicate by name + date (same event might be on multiple platforms)
  const dedupedEvents = deduplicateEvents(allEvents)

  // Remove past events (with grace window), add distance + score, and sort by relevance
  const upcomingEvents = filterPastEvents(dedupedEvents)
  const enhancedEvents = enhanceEvents(upcomingEvents, { lat, lng, radiusKm })
  const sortedEvents = sortEvents(enhancedEvents, 'recommended')

  // Calculate pagination info from Ticketmaster response
  const tmPagination = tmData.pagination
  const currentPage = tmPagination?.number ?? startPage
  const totalPages = tmPagination?.totalPages ?? 0
  const hasMore = tmPagination ? (currentPage + pagesToFetch) < totalPages : false
  const totalAvailable = tmPagination?.totalElements ?? sortedEvents.length

  const responseData = {
    events: sortedEvents,
    hasMore,
    totalAvailable,
    currentPage: currentPage + pagesToFetch, // Next page to fetch
    pagesLoaded: pagesToFetch
  }

  // Update cache only for initial load
  if (startPage === 0) {
    combinedCache = {
      data: responseData,
      location: cacheKey,
      timestamp: Date.now()
    }
  }

  return responseData
}

/**
 * Fetch more events (for "Load More" functionality)
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radiusKm - Search radius in km
 * @param {number} startPage - Page to start fetching from
 * @param {number} pagesToFetch - Number of pages to fetch
 * @returns {Promise<{events: RoamEvent[], hasMore: boolean, totalAvailable: number, currentPage: number}>}
 */
export async function fetchMoreEvents(lat, lng, radiusKm, startPage, pagesToFetch = 3) {
  return fetchAllEvents(lat, lng, radiusKm, { pagesToFetch, startPage })
}

/**
 * Deduplicate events that appear on multiple platforms
 * Prefers Ticketmaster > Skiddle for data quality
 *
 * Uses multiple keys to catch different types of duplicates:
 * 1. Primary key: normalized name + date + location
 * 2. Fuzzy key: first few words of name + date (catches slight name variations)
 */
function deduplicateEvents(events) {
  const seenByPrimary = new Map()  // primaryKey -> event
  const seenByFuzzy = new Map()    // fuzzyKey -> primaryKey (reverse lookup)
  const sourceRank = { ticketmaster: 1, skiddle: 2 }

  for (const event of events) {
    const primaryKey = buildEventKey(event)
    const fuzzyKey = buildFuzzyEventKey(event)

    // Check if we've seen this event before (by either key)
    const existingByPrimary = seenByPrimary.get(primaryKey)
    const existingPrimaryKeyByFuzzy = fuzzyKey ? seenByFuzzy.get(fuzzyKey) : null
    const existingByFuzzy = existingPrimaryKeyByFuzzy ? seenByPrimary.get(existingPrimaryKeyByFuzzy) : null
    const existing = existingByPrimary || existingByFuzzy

    if (!existing) {
      // New event - add to both maps
      seenByPrimary.set(primaryKey, event)
      if (fuzzyKey) seenByFuzzy.set(fuzzyKey, primaryKey)
    } else {
      // Duplicate found - keep the higher-ranked source
      const existingRank = sourceRank[existing.source] || 99
      const newRank = sourceRank[event.source] || 99

      if (newRank < existingRank) {
        // New event has higher rank - replace the old one
        // First, remove the old event's primary key entry if it came via fuzzy match
        if (existingByFuzzy && existingPrimaryKeyByFuzzy && existingPrimaryKeyByFuzzy !== primaryKey) {
          seenByPrimary.delete(existingPrimaryKeyByFuzzy)
        }
        // Add new event
        seenByPrimary.set(primaryKey, event)
        if (fuzzyKey) seenByFuzzy.set(fuzzyKey, primaryKey)
      }
      // If existing has higher/equal rank, we keep it and ignore the new event
    }
  }

  return Array.from(seenByPrimary.values())
}

/**
 * Build a deduplication key with name + date + location bucket
 */
function buildEventKey(event) {
  const name = normalizeText(event.name)
  const dateKey = event.datetime?.start?.toDateString() || 'nodate'
  const locationKey = getLocationKey(event)
  return `${name}_${dateKey}_${locationKey}`
}

/**
 * Build a fuzzy key using first significant words of the name + date
 * Catches duplicates where the same event has slightly different names
 * e.g., "Taylor Swift - Eras Tour" vs "Taylor Swift: The Eras Tour"
 */
function buildFuzzyEventKey(event) {
  const name = event.name || ''
  // Extract first 3 significant words (skip articles and connectors)
  const words = name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !['the', 'and', 'for', 'with'].includes(w))
    .slice(0, 3)

  if (words.length < 2) return null // Not enough words for fuzzy match

  const dateKey = event.datetime?.start?.toDateString() || 'nodate'
  return `fuzzy_${words.join('_')}_${dateKey}`
}

function normalizeText(value) {
  if (!value) return ''
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function getLocationKey(event) {
  const lat = event.venue?.lat
  const lng = event.venue?.lng
  if (typeof lat === 'number' && typeof lng === 'number') {
    return `${lat.toFixed(2)},${lng.toFixed(2)}`
  }
  return normalizeText(event.venue?.name || event.venue?.address || '')
}

/**
 * Filter out events that already ended (with a grace window)
 */
function filterPastEvents(events, now = new Date()) {
  const cutoff = new Date(now.getTime() - (PAST_EVENT_GRACE_HOURS * 60 * 60 * 1000))
  return events.filter(event => {
    const start = event.datetime?.start
    return !start || start >= cutoff
  })
}

/**
 * Add distance and relevance score to events
 */
function enhanceEvents(events, { lat, lng, radiusKm }) {
  const now = new Date()

  return events.map(event => {
    const distanceKm = calculateDistanceKm(lat, lng, event.venue?.lat, event.venue?.lng)
    const scoredEvent = {
      ...event,
      distanceKm
    }

    return {
      ...scoredEvent,
      score: scoreEvent(scoredEvent, { now, radiusKm })
    }
  })
}

/**
 * Sort events by different strategies
 */
export function sortEvents(events, sortBy = 'recommended') {
  const list = [...events]

  switch (sortBy) {
    case 'soonest':
      return list.sort((a, b) => compareDates(a.datetime?.start, b.datetime?.start))
    case 'nearest':
      return list.sort((a, b) => compareNumbers(a.distanceKm, b.distanceKm))
    case 'popular':
      return list.sort((a, b) => {
        const aScore = getPopularityScore(a)
        const bScore = getPopularityScore(b)
        if (bScore !== aScore) return bScore - aScore
        return compareDates(a.datetime?.start, b.datetime?.start)
      })
    case 'recommended':
    default:
      return list.sort((a, b) => {
        const aScore = a.score ?? 0
        const bScore = b.score ?? 0
        if (bScore !== aScore) return bScore - aScore
        return compareDates(a.datetime?.start, b.datetime?.start)
      })
  }
}

function compareDates(a, b) {
  const dateA = a instanceof Date && !isNaN(a) ? a : new Date(9999, 11, 31)
  const dateB = b instanceof Date && !isNaN(b) ? b : new Date(9999, 11, 31)
  return dateA - dateB
}

function compareNumbers(a, b) {
  const numA = typeof a === 'number' ? a : Number.POSITIVE_INFINITY
  const numB = typeof b === 'number' ? b : Number.POSITIVE_INFINITY
  return numA - numB
}

function getPopularityScore(event) {
  const goingCount = event.goingCount || 0
  const soldOutBoost = event.isSoldOut ? 25 : 0
  return Math.min(50, Math.log10(goingCount + 1) * 20) + soldOutBoost
}

/**
 * Calculate distance between two points in km (Haversine)
 */
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  if (typeof lat1 !== 'number' || typeof lon1 !== 'number' || typeof lat2 !== 'number' || typeof lon2 !== 'number') {
    return null
  }
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Score an event for relevance
 */
function scoreEvent(event, { now, radiusKm }) {
  let score = 0
  const start = event.datetime?.start instanceof Date ? event.datetime.start : null

  if (start && !isNaN(start)) {
    const hoursUntil = (start - now) / (1000 * 60 * 60)
    if (hoursUntil < -PAST_EVENT_GRACE_HOURS) {
      return -9999
    }
    if (hoursUntil <= 6) score += 26
    else if (hoursUntil <= 24) score += 22
    else if (hoursUntil <= 72) score += 18
    else if (hoursUntil <= 168) score += 12
    else if (hoursUntil <= 336) score += 6
    else score += 3
  } else {
    score += 4
  }

  if (typeof event.distanceKm === 'number') {
    const radius = radiusKm || 50
    const proximityScore = Math.max(0, 1 - (event.distanceKm / radius))
    score += proximityScore * 28
  } else {
    score += 2
  }

  if (event.pricing?.isFree) score += 10
  if (event.isSoldOut) score -= 20

  if (event.imageUrl) score += 6
  if (event.description) score += Math.min(6, event.description.length / 50)

  if (event.goingCount) {
    score += Math.min(12, Math.log10(event.goingCount + 1) * 6)
  }

  if (event.source === 'ticketmaster') score += 4
  if (event.source === 'skiddle') score += 2

  return Math.round(score * 10) / 10
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
 * Get events happening tomorrow
 */
export function getTomorrowEvents(events) {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toDateString()
  return events.filter(e => e.datetime?.start?.toDateString() === tomorrowStr)
}

/**
 * Get events happening this week (next 7 days)
 */
export function getThisWeekEvents(events) {
  const now = new Date()
  now.setHours(0, 0, 0, 0)

  const weekEnd = new Date(now)
  weekEnd.setDate(weekEnd.getDate() + 7)

  return events.filter(e => {
    const start = e.datetime?.start
    return start && start >= now && start < weekEnd
  })
}

/**
 * Get events happening this month (next 30 days)
 */
export function getThisMonthEvents(events) {
  const now = new Date()
  now.setHours(0, 0, 0, 0)

  const monthEnd = new Date(now)
  monthEnd.setDate(monthEnd.getDate() + 30)

  return events.filter(e => {
    const start = e.datetime?.start
    return start && start >= now && start < monthEnd
  })
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
    skiddle: { name: 'Skiddle', color: '#FF5500' }
  }
  return sources[source] || { name: source, color: '#666' }
}

export default {
  fetchAllEvents,
  fetchMoreEvents,
  getTodayEvents,
  getTomorrowEvents,
  getWeekendEvents,
  getThisWeekEvents,
  getThisMonthEvents,
  getFreeEvents,
  getEventsByCategory,
  formatEventDate,
  formatPriceRange,
  getSourceInfo,
  sortEvents
}

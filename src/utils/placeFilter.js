/**
 * ROAM Place Filter & Scorer
 * Smart recommendation system with variety, time-awareness, and quality scoring
 */

import {
  GOOD_CATEGORIES,
  BLACKLIST,
  isBlacklisted,
  hasBoringName,
  getCategoryForType
} from './categories'
import { getPersonalizationBoost } from './tasteProfile'

// Session storage key for tracking shown places
const SHOWN_PLACES_KEY = 'roam_shown_places'
const SHOWN_PLACES_MAX = 100

/**
 * Get time-of-day context for smarter recommendations
 */
function getTimeContext() {
  const hour = new Date().getHours()

  if (hour >= 6 && hour < 11) return 'morning'      // 6am-11am
  if (hour >= 11 && hour < 14) return 'lunch'       // 11am-2pm
  if (hour >= 14 && hour < 17) return 'afternoon'   // 2pm-5pm
  if (hour >= 17 && hour < 21) return 'evening'     // 5pm-9pm
  return 'night'                                     // 9pm-6am
}

/**
 * Categories that are better at certain times
 */
const TIME_BOOSTS = {
  morning: { food: 10, nature: 5 },           // Cafes, parks for morning walks
  lunch: { food: 15 },                        // Restaurants
  afternoon: { culture: 10, historic: 10, shopping: 5, nature: 5 },
  evening: { food: 10, nightlife: 15, entertainment: 10 },
  night: { nightlife: 20, food: 5 }
}

/**
 * Categories better for certain weather
 */
const WEATHER_BOOSTS = {
  good: { nature: 15, active: 10, unique: 5 },      // Outdoor activities
  bad: { culture: 15, entertainment: 15, food: 10, shopping: 10 }  // Indoor activities
}

/**
 * Score a place based on quality signals and context
 * @param {Object} place - Place object from API
 * @param {Object} context - Context for scoring (time, weather, etc.)
 * @returns {number} Score from 0-100
 */
export function scorePlace(place, context = {}) {
  let score = 0
  const { timeContext = getTimeContext(), weather = null } = context

  // Base score for being in a good category
  const category = getCategoryForType(place.type)
  if (category) {
    score += 35
  }

  // OpenTripMap places (curated tourist attractions)
  if (place.source === 'opentripmap') {
    score += 12
    if (place.rating >= 3) score += 8
  }

  // Photo bonus
  if (place.photo || place.image) {
    score += 12
  }

  // Website bonus
  if (place.website) {
    score += 6
  }

  // Opening hours bonus
  if (place.openingHours || place.opening_hours) {
    score += 6
  }

  // Description bonus
  if (place.description && place.description.length > 20) {
    score += 8
  }

  // Wikipedia/Wikidata bonus (notable place)
  if (place.wikipedia || place.wikidata) {
    score += 10
  }

  // Contact info bonus
  if (place.phone || place.email) {
    score += 3
  }

  // Address bonus
  if (place.address) {
    score += 3
  }

  // Penalty for blacklisted type
  if (isBlacklisted(place.type)) {
    score -= 100
  }

  // Penalty for boring name
  if (hasBoringName(place.name)) {
    score -= 50
  }

  // Premium types bonus
  const premiumTypes = [
    'museum', 'castle', 'viewpoint', 'beach', 'botanical_garden', 'national_park',
    'abbey', 'cathedral', 'stately_home', 'manor', 'priory', 'country_park',
    'nature_reserve', 'lido', 'standing_stone', 'hill_fort', 'folly', 'lighthouse',
    'windmill', 'canal_lock', 'walled_garden', 'maze'
  ]
  if (premiumTypes.includes(place.type)) {
    score += 12
  }

  // Interesting name patterns bonus
  const interestingNamePatterns = [
    /the\s/i, /old\s/i, /royal/i, /ancient/i, /historic/i,
    /manor/i, /hall/i, /house/i, /arms/i, /inn/i, /lodge/i
  ]
  if (interestingNamePatterns.some(pattern => pattern.test(place.name))) {
    score += 4
  }

  // TIME-OF-DAY CONTEXTUAL BOOST
  if (category && TIME_BOOSTS[timeContext]) {
    const boost = TIME_BOOSTS[timeContext][category.key] || 0
    score += boost
  }

  // WEATHER CONTEXTUAL BOOST
  if (category && weather) {
    const weatherType = isGoodWeather(weather) ? 'good' : 'bad'
    const boost = WEATHER_BOOSTS[weatherType][category.key] || 0
    score += boost
  }

  // PERSONALIZATION BOOST (max +15, min -10)
  // Based on user's demonstrated preferences from ratings, saves, visits
  const { userProfile = null } = context
  if (userProfile) {
    const personalBoost = getPersonalizationBoost(place, userProfile)
    score += personalBoost
  }

  // VIBE BOOST (max +20)
  // User's selected vibe as preference, not hard filter
  // Places matching the vibe rank higher, but others still appear
  const { vibeCategories = null } = context
  if (vibeCategories && vibeCategories.length > 0 && category) {
    if (vibeCategories.includes(category.key)) {
      score += 20
    }
  }

  return Math.max(0, Math.min(100, score))
}

/**
 * Determine if weather is good for outdoor activities
 */
function isGoodWeather(weather) {
  if (!weather) return true // Assume good if unknown

  // Bad weather codes from Open-Meteo
  const badWeatherCodes = [
    45, 48,           // Fog
    51, 53, 55,       // Drizzle
    61, 63, 65,       // Rain
    71, 73, 75,       // Snow
    80, 81, 82,       // Showers
    95                // Thunderstorm
  ]

  return !badWeatherCodes.includes(weather.weatherCode)
}

/**
 * Filter and score places with smart selection
 * @param {Array} places - Array of place objects
 * @param {Object} options - Filter options
 * @returns {Array} Filtered and scored places with variety
 */
export function filterPlaces(places, options = {}) {
  const {
    minScore = 30,
    categories = null,
    maxResults = 50,
    sortBy = 'smart', // 'smart', 'score', 'distance', 'name'
    weather = null,
    ensureDiversity = true, // Mix categories when no filter selected
    userProfile = null // Taste profile for personalized scoring
  } = options

  // Pass categories as vibeCategories for soft boost scoring (not hard filter)
  const context = { timeContext: getTimeContext(), weather, userProfile, vibeCategories: categories }

  let filtered = places
    // Remove blacklisted types
    .filter(place => !isBlacklisted(place.type || ''))
    // Remove boring names
    .filter(place => !hasBoringName(place.name))
    // NOTE: Categories now applied as BOOST in scorePlace(), not hard filter
    // This ensures vibe-matching places rank higher while maintaining diversity
    // Add scores with context (including vibe boost)
    .map(place => ({
      ...place,
      score: scorePlace(place, context),
      category: getCategoryForType(place.type)
    }))
    // Filter by minimum score
    .filter(place => place.score >= minScore)

  // SMART SELECTION: Always ensure category diversity for varied itineraries
  if (sortBy === 'smart' && ensureDiversity) {
    return selectWithDiversity(filtered, maxResults)
  }

  // Traditional sorting
  if (sortBy === 'score' || sortBy === 'smart') {
    // Add randomization factor to prevent same order every time
    filtered = shuffleWithWeight(filtered)
  } else if (sortBy === 'distance' && filtered[0]?.distance !== undefined) {
    filtered.sort((a, b) => a.distance - b.distance)
  } else if (sortBy === 'name') {
    filtered.sort((a, b) => a.name.localeCompare(b.name))
  }

  return filtered.slice(0, maxResults)
}

/**
 * Get geographic zone key for a place
 * Divides the map into grid cells (~500m x 500m at mid-latitudes)
 */
function getGeoZone(place, precision = 0.005) {
  if (!place.lat || !place.lng) return 'unknown'
  const latZone = Math.floor(place.lat / precision)
  const lngZone = Math.floor(place.lng / precision)
  return `${latZone},${lngZone}`
}

/**
 * Select places ensuring both category AND geographic diversity
 * Creates a balanced mix across categories AND spreads them across the map
 */
function selectWithDiversity(places, maxResults) {
  // Group by category first
  const byCategory = {}
  for (const place of places) {
    const key = place.category?.key || 'other'
    if (!byCategory[key]) byCategory[key] = []
    byCategory[key].push(place)
  }

  // Within each category, group by geographic zone
  // Then shuffle zones and places within zones
  for (const catKey of Object.keys(byCategory)) {
    const catPlaces = byCategory[catKey]
    const byZone = {}

    for (const place of catPlaces) {
      const zoneKey = getGeoZone(place)
      if (!byZone[zoneKey]) byZone[zoneKey] = []
      byZone[zoneKey].push(place)
    }

    // Shuffle within each zone (weighted by score)
    for (const zoneKey of Object.keys(byZone)) {
      byZone[zoneKey] = shuffleWithWeight(byZone[zoneKey])
    }

    // Round-robin from zones to spread geographically
    const zoneKeys = Object.keys(byZone)
    shuffleArray(zoneKeys)

    const zoneSorted = []
    const zoneIndices = {}
    zoneKeys.forEach(k => zoneIndices[k] = 0)

    let remaining = catPlaces.length
    while (remaining > 0) {
      for (const zoneKey of zoneKeys) {
        const zonePlaces = byZone[zoneKey]
        const idx = zoneIndices[zoneKey]
        if (idx < zonePlaces.length) {
          zoneSorted.push(zonePlaces[idx])
          zoneIndices[zoneKey]++
          remaining--
        }
      }
    }

    byCategory[catKey] = zoneSorted
  }

  // Round-robin selection from categories
  const selected = []
  const categoryKeys = Object.keys(byCategory)
  const categoryIndices = {}
  categoryKeys.forEach(k => categoryIndices[k] = 0)

  // Shuffle category order for variety
  shuffleArray(categoryKeys)

  let attempts = 0
  const maxAttempts = maxResults * 3

  while (selected.length < maxResults && attempts < maxAttempts) {
    for (const catKey of categoryKeys) {
      if (selected.length >= maxResults) break

      const catPlaces = byCategory[catKey]
      const idx = categoryIndices[catKey]

      if (idx < catPlaces.length) {
        selected.push(catPlaces[idx])
        categoryIndices[catKey]++
      }
    }
    attempts++
  }

  return selected
}

/**
 * Shuffle array with score weighting
 * Higher scored items more likely to appear earlier, but with randomness
 */
function shuffleWithWeight(places) {
  if (places.length === 0) return places

  const result = []
  const available = [...places]

  while (available.length > 0) {
    // Use score as weight but add significant randomness
    const weights = available.map(p => p.score + Math.random() * 30)
    const maxIdx = weights.indexOf(Math.max(...weights))
    result.push(available[maxIdx])
    available.splice(maxIdx, 1)
  }

  return result
}

/**
 * Simple Fisher-Yates shuffle
 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Get a random selection of quality places
 * Avoids recently shown places for better variety
 * @param {Array} places - Array of place objects
 * @param {number} count - Number of places to return
 * @param {Object} options - Filter options
 * @returns {Array} Random selection of quality places
 */
export function getRandomQualityPlaces(places, count = 10, options = {}) {
  const { avoidRecent = true, ...filterOptions } = options

  // Get recently shown place IDs
  const recentlyShown = avoidRecent ? getRecentlyShownPlaces() : new Set()

  const filtered = filterPlaces(places, { ...filterOptions, maxResults: 100 })

  // Separate into fresh and recent
  const fresh = filtered.filter(p => !recentlyShown.has(String(p.id)))
  const recent = filtered.filter(p => recentlyShown.has(String(p.id)))

  // Prioritize fresh places
  const pool = [...fresh, ...recent]

  // Weighted random selection
  const selected = []
  const available = [...pool]

  while (selected.length < count && available.length > 0) {
    // Score + randomness + freshness bonus
    const weights = available.map((p, idx) => {
      const isFresh = idx < fresh.length
      return p.score + Math.random() * 25 + (isFresh ? 15 : 0)
    })

    const maxIdx = weights.indexOf(Math.max(...weights))
    selected.push(available[maxIdx])
    available.splice(maxIdx, 1)
  }

  // Track shown places
  if (selected.length > 0) {
    trackShownPlaces(selected.map(p => String(p.id)))
  }

  return selected
}

/**
 * Get set of recently shown place IDs from session storage
 */
function getRecentlyShownPlaces() {
  try {
    const stored = sessionStorage.getItem(SHOWN_PLACES_KEY)
    return stored ? new Set(JSON.parse(stored)) : new Set()
  } catch {
    return new Set()
  }
}

/**
 * Track places that have been shown to the user
 */
function trackShownPlaces(placeIds) {
  try {
    const existing = getRecentlyShownPlaces()
    placeIds.forEach(id => existing.add(id))

    // Keep only most recent
    const arr = Array.from(existing)
    const trimmed = arr.slice(-SHOWN_PLACES_MAX)

    sessionStorage.setItem(SHOWN_PLACES_KEY, JSON.stringify(trimmed))
  } catch {
    // Session storage not available
  }
}

/**
 * Clear the recently shown places (call when user wants fresh results)
 */
export function clearShownPlaces() {
  try {
    sessionStorage.removeItem(SHOWN_PLACES_KEY)
  } catch {
    // Session storage not available
  }
}

/**
 * Check if a place is open now
 * @param {Object} place - Place object
 * @returns {boolean|null} true if open, false if closed, null if unknown
 */
export function isOpenNow(place) {
  const hours = place.openingHours || place.opening_hours
  if (!hours) return null

  // Simple check - would need more sophisticated parsing for real use
  const now = new Date()
  // Reserved for future use when implementing full opening hours parsing
  const _day = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
  const _time = now.getHours() * 100 + now.getMinutes()

  // This is a simplified check - real implementation would parse hours properly
  if (typeof hours === 'string') {
    if (hours.toLowerCase().includes('24/7') || hours.toLowerCase().includes('24 hours')) {
      return true
    }
  }

  return null // Unknown
}

/**
 * Enhance place with additional computed properties
 * @param {Object} place - Place object
 * @param {Object} userLocation - User's location {lat, lng}
 * @param {Object} context - Optional context for scoring (weather, etc.)
 * @returns {Object} Enhanced place object
 */
export function enhancePlace(place, userLocation, context = {}) {
  return {
    ...place,
    score: scorePlace(place, context),
    category: getCategoryForType(place.type),
    isOpen: isOpenNow(place),
    distance: userLocation ? calculateDistance(
      userLocation.lat,
      userLocation.lng,
      place.lat,
      place.lng
    ) : null
  }
}

/**
 * Calculate distance between two coordinates in km
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371 // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

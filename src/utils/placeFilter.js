/**
 * ROAM Place Filter & Scorer
 * Smart recommendation system with variety, time-awareness, and quality scoring
 */

import {
  GOOD_CATEGORIES,
  shouldKeepPlace,
  hasBoringName,
  getCategoryForType
} from './categories'
import { getPersonalizationBoost } from './tasteProfile'
import { isChainPlace, CHAIN_PENALTY } from './badges'
import { haversineKm } from '../../shared/geo.mjs'
import { isPlaceOpen } from './openingHours'

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
  good: { nature: 8, active: 8, unique: 8, entertainment: 5 },  // Balanced outdoor boost
  bad: { culture: 12, entertainment: 12, food: 10, shopping: 8 }  // Indoor activities
}

/**
 * Score a place based on quality signals and context
 * @param {Object} place - Place object from API
 * @param {Object} context - Context for scoring (time, weather, etc.)
 * @returns {number} Score from 0-100
 */
export function scorePlace(place, context = {}) {
  return applyChainPenalty(place, scorePlaceBase(place, context))
}

/**
 * Chains are demoted in ORDER only. The penalty applies after the 0-100
 * clamp (so two maxed-out places still order indie first) and is not used
 * for the minScore gate in filterPlaces, so a chain is never dropped just
 * for being a chain.
 */
function applyChainPenalty(place, baseScore) {
  return isChainPlace(place) ? Math.max(0, baseScore - CHAIN_PENALTY) : baseScore
}

function scorePlaceBase(place, context = {}) {
  let score = 0
  const { timeContext = getTimeContext(), weather = null } = context

  // Base score for being in a good category
  const category = getCategoryForType(place.type)
  if (category) {
    score += 35
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

  // Blacklisted types are dropped by shouldKeepPlace in filterPlaces
  // (rescued famous places survive there); no score penalty — a rescued
  // place ranks on its own merits, not pinned to the bottom.

  // Penalty for boring name
  if (hasBoringName(place.name)) {
    score -= 50
  }

  // Premium types bonus — using canonical OSM values from the new
  // categories list. Previously this list referenced types like
  // 'abbey', 'cathedral', 'stately_home', 'priory', 'concert_hall',
  // 'opera_house', 'folly', 'maze', 'botanical_garden',
  // 'national_park', 'country_park' that aren't real OSM values, so
  // the +12 boost never fired for them.
  const premiumTypes = [
    // Culture
    'museum', 'gallery', 'theatre', 'planetarium', 'music_venue',
    'exhibition_centre',
    // Historic
    'castle', 'manor', 'archaeological_site', 'fort', 'monument',
    'ruins', 'temple',
    // Entertainment
    'zoo', 'aquarium', 'theme_park', 'escape_game', 'water_park',
    // Unique landmarks
    'viewpoint', 'lighthouse', 'windmill', 'attraction', 'artwork',
    // Nature destinations
    'beach', 'nature_reserve', 'peak', 'hot_spring', 'geyser',
    'volcano',
  ]
  if (premiumTypes.includes(place.type)) {
    score += 12
  }

  // DIRECT tourism overlay bonus — tourism=attraction is OSM's
  // explicit "this is worth visiting" tag. A pub tagged as
  // amenity=pub + tourism=attraction (e.g. a famous historic pub)
  // should rank above a pub without the tourism overlay. The
  // category-from-type extraction loses this signal because amenity
  // wins, so we re-introduce it here as an independent bonus.
  if (place.tourism === 'attraction') score += 10
  if (place.tourism === 'museum') score += 12
  if (place.tourism === 'viewpoint') score += 8
  if (place.tourism === 'theme_park') score += 10

  // Heritage / designation — UK Listed Buildings, US National Register
  // of Historic Places, French Monument historique, etc. Strong
  // signal that the place is documented as nationally important.
  if (place.heritage || place.designation) score += 12

  // Paid entry usually means a real ticketed attraction, not a
  // tagged spot on the map.
  if (place.fee === 'yes') score += 5

  // OSM image / Wikimedia Commons tagged on the place — sparse but
  // high signal (mapper went out of their way to hang a photo).
  if (place.image || place.wikimedia_commons) score += 6

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

  // FRIEND ACTIVITY BOOST (max +15)
  // Invisible boost - places friends have saved/visited rank higher organically
  // This makes friend recommendations feel natural, not forced
  const { friendActivity = null } = context
  if (friendActivity?.[place.id]) {
    const activity = friendActivity[place.id]
    // +3 per friend who saved (max 3 friends counted = 9 points)
    const friendSaveBoost = Math.min(activity.friendsSaved?.length || 0, 3) * 3
    // +5 per friend who visited and recommended (max 2 friends = 10 points)
    const recommendedVisits = (activity.friendsVisited || []).filter(f => f.recommended).length
    const friendVisitBoost = Math.min(recommendedVisits, 2) * 5
    // Cap total friend boost at 15 to prevent overwhelming other signals
    const friendBoost = Math.min(friendSaveBoost + friendVisitBoost, 15)
    score += friendBoost
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
 * Plain-language weather verdict for copy such as "Great indoor option
 * today". Returns null when weather is unknown so callers say nothing
 * rather than guess.
 * @returns {'wet'|'cold'|'fine'|null}
 */
export function weatherVerdict(weather) {
  if (!weather || typeof weather.weatherCode !== 'number') return null
  if (!isGoodWeather(weather)) return 'wet'
  if (typeof weather.temperature === 'number' && weather.temperature < 8) return 'cold'
  return 'fine'
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
    userProfile = null, // Taste profile for personalized scoring
    friendActivity = null, // Per-place friend save/visit map for the boost
    seed = SESSION_SEED, // Varies the deck between page loads, stable within one
  } = options

  // Pass categories as vibeCategories for soft boost scoring (not hard filter)
  const context = { timeContext: getTimeContext(), weather, userProfile, vibeCategories: categories, friendActivity }

  let filtered = places
    // Remove blacklisted types, BUT rescue famous places that happen
    // to share a blacklisted type — e.g. Westminster Abbey is
    // amenity=place_of_worship (blacklisted) but also tourism=
    // attraction + has wikipedia, so shouldKeepPlace overrides the
    // type ban. Tiny village chapels (blacklisted type, no positive
    // signals) still drop out.
    .filter(place => shouldKeepPlace(place))
    // OSM access=private / access=no: members-only clubs, private
    // gardens, staff car parks. Nobody can actually go, so never deal them.
    .filter(place => !isNoAccess(place))
    // Remove boring names — same rescue logic: chain stores with
    // wikipedia (rare but possible — original-location stores,
    // iconic flagships) get kept.
    .filter(place => {
      if (!hasBoringName(place.name)) return true
      return Boolean(place.wikipedia || place.heritage || place.tourism === 'attraction')
    })
    // Add category info first so we can filter by it
    .map(place => ({
      ...place,
      category: getCategoryForType(place.type)
    }))
    // Hard filter by selected categories (if any selected)
    .filter(place => {
      if (!categories || categories.length === 0) return true
      return place.category && categories.includes(place.category.key)
    })
    // Add scores with context. The quality gate uses the base score;
    // the chain penalty only affects ordering (see applyChainPenalty).
    .map(place => {
      const baseScore = scorePlaceBase(place, context)
      return { ...place, baseScore, score: applyChainPenalty(place, baseScore) }
    })
    // Filter by minimum score
    .filter(place => place.baseScore >= minScore)
    .map(({ baseScore: _baseScore, ...place }) => place)

  // SMART SELECTION: Always ensure category diversity for varied itineraries
  if (sortBy === 'smart' && ensureDiversity) {
    return selectWithDiversity(filtered, maxResults, seed)
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

function isNoAccess(place) {
  const access = String(place?.access || '').toLowerCase()
  return access === 'private' || access === 'no'
}

// One seed per page load: the deck differs between reloads, but repeated
// filterPlaces calls in one session (every React re-render) return the same
// order. A per-call Math.random here once made the deck reshuffle itself on
// re-render, see shuffleWithWeight below.
const SESSION_SEED = Math.floor(Math.random() * 2 ** 31)

/** Stable pseudo-random number in [0, 1) for a place id under a seed (FNV-1a). */
function seededUnit(id, seed) {
  let h = 2166136261 ^ seed
  const str = String(id ?? '')
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 2 ** 32
}

// Opening-hours parsing is the slow part of ranking, and many places share
// the same hours string, so cache the verdict per string for five minutes.
const openCache = { bucket: -1, map: new Map() }
function openNowCached(place) {
  const hours = place.openingHours || place.opening_hours
  if (!hours) return null
  const bucket = Math.floor(Date.now() / 300000)
  if (openCache.bucket !== bucket) {
    openCache.bucket = bucket
    openCache.map.clear()
  }
  if (!openCache.map.has(hours)) openCache.map.set(hours, isPlaceOpen(place))
  return openCache.map.get(hours)
}

/** Known to be closed right now from its opening_hours (unknown hours = false). */
export function isClosedNow(place) {
  return openNowCached(place) === false
}

// Deck ranking weights, on top of the 0-100 quality score.
export const DECK_WEIGHTS = {
  nearest: 20,   // the nearest place in the pool, fading to 0 for the furthest
  openNow: 8,    // known to be open right now
  closedNow: -15, // known to be closed right now (kept, just later)
  jitter: 12,    // seeded randomness so reloads aren't identical
}

/**
 * Rank used inside the diversity weave: quality score, plus a pull towards
 * nearer and open-now places, plus a little seeded randomness.
 */
function deckRank(place, maxDistance, seed) {
  let rank = place.score ?? 0
  if (typeof place.distance === 'number' && maxDistance > 0) {
    rank += DECK_WEIGHTS.nearest * (1 - Math.min(1, place.distance / maxDistance))
  }
  const open = openNowCached(place)
  if (open === true) rank += DECK_WEIGHTS.openNow
  else if (open === false) rank += DECK_WEIGHTS.closedNow
  rank += DECK_WEIGHTS.jitter * seededUnit(place.id, seed)
  return rank
}

/**
 * Select places ensuring both category AND geographic diversity.
 *
 * Categories take turns (round-robin), and within a category the ~500m map
 * zones take turns, so the deck is a mix of kinds of place spread over the
 * area. Inside that weave everything is ordered by deckRank, so the first
 * card of each category and zone is the nearest, open, good-quality one, and
 * the seeded jitter changes the mix between page loads.
 */
function selectWithDiversity(places, maxResults, seed = SESSION_SEED) {
  const maxDistance = places.reduce(
    (max, p) => (typeof p.distance === 'number' && p.distance > max ? p.distance : max), 0)
  const ranks = new Map(places.map(p => [p, deckRank(p, maxDistance, seed)]))
  const byRank = (a, b) => ranks.get(b) - ranks.get(a)

  // Group by category first
  const byCategory = {}
  for (const place of places) {
    const key = place.category?.key || 'other'
    if (!byCategory[key]) byCategory[key] = []
    byCategory[key].push(place)
  }

  // Within each category, group by geographic zone, rank each zone, then
  // round-robin the zones (best zone first) to spread geographically
  for (const catKey of Object.keys(byCategory)) {
    const catPlaces = byCategory[catKey]
    const byZone = {}

    for (const place of catPlaces) {
      const zoneKey = getGeoZone(place)
      if (!byZone[zoneKey]) byZone[zoneKey] = []
      byZone[zoneKey].push(place)
    }

    for (const zoneKey of Object.keys(byZone)) byZone[zoneKey].sort(byRank)
    const zoneKeys = Object.keys(byZone).sort((a, b) => byRank(byZone[a][0], byZone[b][0]))

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

    // Zone round-robin takes each zone's best place first, so a zone that
    // only holds a Starbucks could still lead the category. Chains go
    // after every independent in their category (order otherwise kept).
    byCategory[catKey] = [
      ...zoneSorted.filter(p => !isChainPlace(p)),
      ...zoneSorted.filter(p => isChainPlace(p)),
    ]
  }

  // Round-robin selection from categories, strongest lead place first
  const selected = []
  const categoryKeys = Object.keys(byCategory)
    .sort((a, b) => byRank(byCategory[a][0], byCategory[b][0]))
  const categoryIndices = {}
  categoryKeys.forEach(k => categoryIndices[k] = 0)

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
 * Order places by score, deterministically.
 *
 * Previously used `score + Math.random() * 30` for "variety", but
 * filterPlaces is called from a React useMemo whose deps (applyFilters
 * callback) can change reference every render via friendActivity from
 * a custom hook. With Math.random in here, every re-render reshuffled
 * the deck — visually identical to the user rapidly swiping cards
 * without touching the screen. Combined with the band filter culling
 * close places and CardStack's "loadMore when ≤10 cards left" trigger,
 * that produced a runaway loop that maxed out the deck.
 *
 * Tiebreaker on ID keeps order stable even if two places have the
 * same score. Variety between sessions can come back later via a
 * session-scoped seed; correctness comes first.
 */
function shuffleWithWeight(places) {
  if (places.length === 0) return places
  return [...places].sort((a, b) => {
    const scoreDiff = (b.score ?? 0) - (a.score ?? 0)
    if (scoreDiff !== 0) return scoreDiff
    return String(a.id ?? '').localeCompare(String(b.id ?? ''))
  })
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
export const calculateDistance = haversineKm

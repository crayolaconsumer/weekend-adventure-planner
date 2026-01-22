/**
 * Taste Profile Utility
 *
 * Analyzes user behavior to build personalization signals.
 * Used to score places based on demonstrated preferences.
 *
 * Data sources:
 * - roam_interests: Onboarding category selections
 * - roam_ratings_v2: Detailed place ratings (vibe, noise, value)
 * - roam_visited_places: Visit history with categories
 * - roam_wishlist: Saved/bookmarked places
 * - roam_stats: Aggregate usage statistics
 */

import { GOOD_CATEGORIES } from './categories'

// Default profile for users with no data
const DEFAULT_PROFILE = {
  categoryAffinities: {},
  categoryDislikes: {}, // Negative signals from skipped places
  vibePreference: null,
  noisePreference: null,
  valuePreference: null,
  avgTripDistance: 3, // km
  prefersFree: false,
  prefersAccessible: false,
  activityLevel: 'moderate', // low, moderate, high
  dataQuality: 0, // 0-100, how much data we have
}

/**
 * Calculate category affinities from user actions
 * Returns normalized scores 0-1 for each category
 */
function calculateCategoryAffinities() {
  const affinities = {}

  // Initialize all categories at 0
  Object.keys(GOOD_CATEGORIES).forEach(key => {
    affinities[key] = 0
  })

  // Source 1: Onboarding interests (weight: 2)
  try {
    const interests = JSON.parse(localStorage.getItem('roam_interests') || '[]')
    interests.forEach(cat => {
      if (affinities[cat] !== undefined) {
        affinities[cat] += 2
      }
    })
  } catch {
    // Ignore parse errors
  }

  // Source 2: Saved places (weight: 3)
  try {
    const wishlist = JSON.parse(localStorage.getItem('roam_wishlist') || '[]')
    wishlist.forEach(place => {
      const cat = place.category?.key || place.categoryKey
      if (cat && affinities[cat] !== undefined) {
        affinities[cat] += 3
      }
    })
  } catch {
    // Ignore parse errors
  }

  // Source 3: Visited places (weight: 4 - strongest signal)
  try {
    const visited = JSON.parse(localStorage.getItem('roam_visited_places') || '[]')
    visited.forEach(place => {
      const cat = place.category?.key || place.categoryKey || place.category
      if (cat && affinities[cat] !== undefined) {
        affinities[cat] += 4
      }
    })
  } catch {
    // Ignore parse errors
  }

  // Source 4: Positive ratings (weight: 5 - strongest intent signal)
  try {
    const ratings = JSON.parse(localStorage.getItem('roam_ratings_v2') || '{}')
    Object.values(ratings).forEach(rating => {
      if (rating.recommended && rating.categoryKey) {
        if (affinities[rating.categoryKey] !== undefined) {
          affinities[rating.categoryKey] += 5
        }
      }
    })
  } catch {
    // Ignore parse errors
  }

  // Normalize to 0-1 scale
  const maxAffinity = Math.max(...Object.values(affinities), 1)
  Object.keys(affinities).forEach(key => {
    affinities[key] = Math.round((affinities[key] / maxAffinity) * 100) / 100
  })

  return affinities
}

/**
 * Calculate category dislikes from skipped places
 * Returns normalized scores 0-1 for disliked categories
 */
function calculateCategoryDislikes() {
  const dislikes = {}

  // Initialize all categories at 0
  Object.keys(GOOD_CATEGORIES).forEach(key => {
    dislikes[key] = 0
  })

  try {
    const notInterested = JSON.parse(localStorage.getItem('roam_not_interested') || '[]')

    // Only consider recent skips (last 7 days)
    const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000)
    const recentSkips = notInterested.filter(skip => skip.timestamp > weekAgo)

    // Count skips by category
    recentSkips.forEach(skip => {
      if (skip.categoryKey && dislikes[skip.categoryKey] !== undefined) {
        dislikes[skip.categoryKey] += 1
      }
    })

    // Normalize to 0-1 scale
    const maxDislike = Math.max(...Object.values(dislikes), 1)
    Object.keys(dislikes).forEach(key => {
      dislikes[key] = Math.round((dislikes[key] / maxDislike) * 100) / 100
    })
  } catch {
    // Ignore parse errors
  }

  return dislikes
}

/**
 * Analyze vibe preferences from ratings
 */
function analyzeVibePreference() {
  try {
    const ratings = JSON.parse(localStorage.getItem('roam_ratings_v2') || '{}')
    const vibes = {}

    Object.values(ratings).forEach(rating => {
      if (rating.vibe && rating.recommended) {
        vibes[rating.vibe] = (vibes[rating.vibe] || 0) + 1
      }
    })

    // Return most common vibe from positive ratings
    let maxVibe = null
    let maxCount = 0
    Object.entries(vibes).forEach(([vibe, count]) => {
      if (count > maxCount) {
        maxCount = count
        maxVibe = vibe
      }
    })

    return maxVibe
  } catch {
    return null
  }
}

/**
 * Analyze noise level preferences from ratings
 */
function analyzeNoisePreference() {
  try {
    const ratings = JSON.parse(localStorage.getItem('roam_ratings_v2') || '{}')
    const noises = {}

    Object.values(ratings).forEach(rating => {
      if (rating.noiseLevel && rating.recommended) {
        noises[rating.noiseLevel] = (noises[rating.noiseLevel] || 0) + 1
      }
    })

    let maxNoise = null
    let maxCount = 0
    Object.entries(noises).forEach(([noise, count]) => {
      if (count > maxCount) {
        maxCount = count
        maxNoise = noise
      }
    })

    return maxNoise
  } catch {
    return null
  }
}

/**
 * Analyze value preferences from ratings
 */
function analyzeValuePreference() {
  try {
    const ratings = JSON.parse(localStorage.getItem('roam_ratings_v2') || '{}')
    const values = {}

    Object.values(ratings).forEach(rating => {
      if (rating.valueForMoney && rating.recommended) {
        values[rating.valueForMoney] = (values[rating.valueForMoney] || 0) + 1
      }
    })

    let maxValue = null
    let maxCount = 0
    Object.entries(values).forEach(([value, count]) => {
      if (count > maxCount) {
        maxCount = count
        maxValue = value
      }
    })

    return maxValue
  } catch {
    return null
  }
}

/**
 * Calculate average trip distance from visited places
 */
function calculateAvgTripDistance() {
  try {
    const visited = JSON.parse(localStorage.getItem('roam_visited_places') || '[]')
    if (visited.length === 0) return 3 // Default 3km

    const distances = visited
      .map(p => p.distance)
      .filter(d => typeof d === 'number' && d > 0)

    if (distances.length === 0) return 3

    const avg = distances.reduce((a, b) => a + b, 0) / distances.length
    return Math.round(avg * 10) / 10
  } catch {
    return 3
  }
}

/**
 * Calculate data quality score (0-100)
 * Higher score = more confident recommendations
 */
function calculateDataQuality() {
  let score = 0

  try {
    const interests = JSON.parse(localStorage.getItem('roam_interests') || '[]')
    if (interests.length > 0) score += 15

    const wishlist = JSON.parse(localStorage.getItem('roam_wishlist') || '[]')
    score += Math.min(wishlist.length * 5, 25)

    const visited = JSON.parse(localStorage.getItem('roam_visited_places') || '[]')
    score += Math.min(visited.length * 8, 40)

    const ratings = JSON.parse(localStorage.getItem('roam_ratings_v2') || '{}')
    score += Math.min(Object.keys(ratings).length * 10, 20)
  } catch {
    // Ignore errors
  }

  return Math.min(score, 100)
}

/**
 * Determine user activity level
 */
function calculateActivityLevel() {
  try {
    const visited = JSON.parse(localStorage.getItem('roam_visited_places') || '[]')
    const stats = JSON.parse(localStorage.getItem('roam_stats') || '{}')

    // Check visit frequency (last 30 days)
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000)
    const recentVisits = visited.filter(p => {
      const visitTime = new Date(p.visitedAt).getTime()
      return visitTime > thirtyDaysAgo
    }).length

    if (recentVisits >= 8 || stats.currentStreak >= 5) return 'high'
    if (recentVisits >= 3 || stats.currentStreak >= 2) return 'moderate'
    return 'low'
  } catch {
    return 'moderate'
  }
}

/**
 * Build complete taste profile from all data sources
 */
export function buildTasteProfile() {
  const profile = {
    categoryAffinities: calculateCategoryAffinities(),
    categoryDislikes: calculateCategoryDislikes(),
    vibePreference: analyzeVibePreference(),
    noisePreference: analyzeNoisePreference(),
    valuePreference: analyzeValuePreference(),
    avgTripDistance: calculateAvgTripDistance(),
    prefersFree: localStorage.getItem('roam_free_only') === 'true',
    prefersAccessible: localStorage.getItem('roam_accessibility') === 'true',
    activityLevel: calculateActivityLevel(),
    dataQuality: calculateDataQuality(),
  }

  // Derive top categories
  const sortedCategories = Object.entries(profile.categoryAffinities)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])

  profile.topCategories = sortedCategories.slice(0, 3).map(([key]) => key)
  profile.topCategory = sortedCategories[0]?.[0] || null

  return profile
}

/**
 * Calculate personalization boost for a place based on taste profile
 * Returns a score modifier (-10 to +15)
 */
export function getPersonalizationBoost(place, profile) {
  if (!profile || profile.dataQuality < 20) {
    return 0 // Not enough data to personalize
  }

  let boost = 0
  const categoryKey = place.category?.key || place.categoryKey

  // Category affinity boost (max +8)
  if (categoryKey && profile.categoryAffinities[categoryKey]) {
    boost += Math.round(profile.categoryAffinities[categoryKey] * 8)
  }

  // Top category boost (+3)
  if (categoryKey === profile.topCategory) {
    boost += 3
  }

  // Category dislike penalty (max -5)
  // Applied when user has repeatedly skipped this category
  if (categoryKey && profile.categoryDislikes?.[categoryKey] > 0.3) {
    // Only penalize if dislike score is significant (>30%)
    boost -= Math.round(profile.categoryDislikes[categoryKey] * 5)
  }

  // Vibe match boost (+2)
  if (profile.vibePreference && place.vibe === profile.vibePreference) {
    boost += 2
  }

  // Noise preference matching (+2 for match, -2 for mismatch)
  // Uses place atmosphere or type to infer noise level
  if (profile.noisePreference) {
    const placeNoise = inferNoiseLevel(place)
    if (placeNoise) {
      if (placeNoise === profile.noisePreference) {
        boost += 2
      } else if (
        (profile.noisePreference === 'quiet' && placeNoise === 'loud') ||
        (profile.noisePreference === 'loud' && placeNoise === 'quiet')
      ) {
        boost -= 2 // Strong mismatch
      }
    }
  }

  // Value preference matching (+2 for budget-friendly when preferred)
  if (profile.valuePreference) {
    const placeValue = inferValueLevel(place)
    if (placeValue) {
      if (profile.valuePreference === 'great' && placeValue === 'budget') {
        boost += 2 // User likes value, place is budget-friendly
      } else if (profile.valuePreference === 'worth-it' && placeValue === 'premium') {
        boost += 1 // User willing to pay for quality
      }
    }
  }

  // Distance preference penalty/boost
  if (place.distance && profile.avgTripDistance) {
    const distanceRatio = place.distance / profile.avgTripDistance
    if (distanceRatio > 2) {
      boost -= 3 // Too far for their typical trip
    } else if (distanceRatio < 0.5) {
      boost += 1 // Closer than usual, slight boost
    }
  }

  // Free place boost for users who prefer free
  if (profile.prefersFree && (!place.fee || place.fee === 'no')) {
    boost += 2
  }

  // Cap the boost to prevent filter bubbles
  return Math.max(-10, Math.min(15, boost))
}

/**
 * Infer noise level from place type and attributes
 */
function inferNoiseLevel(place) {
  const quietTypes = [
    'museum', 'library', 'art_gallery', 'spa', 'garden',
    'botanical_garden', 'cemetery', 'church', 'temple',
    'abbey', 'cathedral', 'nature_reserve', 'park'
  ]
  const loudTypes = [
    'nightclub', 'bar', 'pub', 'sports_bar', 'music_venue',
    'concert_hall', 'stadium', 'arcade', 'bowling_alley'
  ]
  const moderateTypes = [
    'restaurant', 'cafe', 'cinema', 'theatre', 'shopping_mall'
  ]

  const type = place.type?.toLowerCase() || ''

  if (quietTypes.some(t => type.includes(t))) return 'quiet'
  if (loudTypes.some(t => type.includes(t))) return 'loud'
  if (moderateTypes.some(t => type.includes(t))) return 'moderate'

  // Check atmosphere tag if available
  if (place.atmosphere) {
    if (['quiet', 'peaceful', 'serene'].includes(place.atmosphere)) return 'quiet'
    if (['lively', 'bustling', 'loud'].includes(place.atmosphere)) return 'loud'
  }

  return null
}

/**
 * Infer value/price level from place attributes
 */
function inferValueLevel(place) {
  // Check explicit fee info
  if (place.fee === 'no' || place.isFree) return 'budget'

  // Check price indicators from OSM data
  const priceLevel = place.priceLevel || place.price_level
  if (priceLevel) {
    if (priceLevel <= 1) return 'budget'
    if (priceLevel >= 3) return 'premium'
    return 'moderate'
  }

  // Infer from place type
  const budgetTypes = ['park', 'beach', 'viewpoint', 'trail', 'picnic_site']
  const premiumTypes = ['fine_dining', 'spa', 'golf_course', 'casino']

  const type = place.type?.toLowerCase() || ''

  if (budgetTypes.some(t => type.includes(t))) return 'budget'
  if (premiumTypes.some(t => type.includes(t))) return 'premium'

  return null
}

/**
 * Get a human-readable explanation of why a place matches
 */
export function getMatchReason(place, profile) {
  if (!profile || profile.dataQuality < 20) return null

  const categoryKey = place.category?.key || place.categoryKey
  const reasons = []

  // Check if it's a top category
  if (categoryKey === profile.topCategory) {
    const categoryLabel = GOOD_CATEGORIES[categoryKey]?.label || categoryKey
    reasons.push(`You love ${categoryLabel.toLowerCase()}`)
  }

  // Check vibe match
  if (profile.vibePreference && place.vibe === profile.vibePreference) {
    const vibeLabels = {
      relaxed: 'relaxed spots',
      lively: 'lively places',
      romantic: 'romantic vibes',
      'family-friendly': 'family-friendly places'
    }
    reasons.push(`Matches your ${vibeLabels[profile.vibePreference] || profile.vibePreference} preference`)
  }

  // Check distance comfort
  if (place.distance && profile.avgTripDistance) {
    if (place.distance <= profile.avgTripDistance * 0.7) {
      reasons.push('Closer than your usual spots')
    }
  }

  return reasons.length > 0 ? reasons[0] : null
}

/**
 * Check if user has enough data for personalization
 */
export function hasEnoughDataForPersonalization() {
  const profile = buildTasteProfile()
  return profile.dataQuality >= 20
}

export default {
  buildTasteProfile,
  getPersonalizationBoost,
  getMatchReason,
  hasEnoughDataForPersonalization,
  DEFAULT_PROFILE
}

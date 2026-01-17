/**
 * Enhanced Ratings Storage
 *
 * Stores detailed user ratings with optional feedback and text reviews.
 * Migrates from legacy binary ratings format automatically.
 */

const RATINGS_KEY = 'roam_ratings_v2'
const LEGACY_RATINGS_KEY = 'roam_ratings'

/**
 * Rating data structure
 * @typedef {Object} PlaceRating
 * @property {boolean} recommended - Would you recommend this place?
 * @property {'relaxed'|'lively'|'romantic'|'family'|null} vibe - Place vibe
 * @property {'quiet'|'moderate'|'loud'|null} noiseLevel - Noise level
 * @property {'great'|'fair'|'expensive'|null} valueForMoney - Value assessment
 * @property {string|null} review - Optional text review (max 500 chars)
 * @property {number} visitedAt - Timestamp of visit
 * @property {string|null} categoryKey - Category of the place
 */

/**
 * Get all ratings from storage
 * @returns {Object<string, PlaceRating>}
 */
export function getAllRatings() {
  try {
    const ratings = localStorage.getItem(RATINGS_KEY)
    if (ratings) {
      return JSON.parse(ratings)
    }

    // Migrate from legacy format if exists
    const legacy = localStorage.getItem(LEGACY_RATINGS_KEY)
    if (legacy) {
      const legacyRatings = JSON.parse(legacy)
      const migrated = migrateLegacyRatings(legacyRatings)
      localStorage.setItem(RATINGS_KEY, JSON.stringify(migrated))
      return migrated
    }

    return {}
  } catch (error) {
    console.error('Error reading ratings:', error)
    return {}
  }
}

/**
 * Get rating for a specific place
 * @param {string} placeId
 * @returns {PlaceRating|null}
 */
export function getRating(placeId) {
  const ratings = getAllRatings()
  return ratings[placeId] || null
}

/**
 * Save a rating for a place
 * @param {string} placeId
 * @param {PlaceRating} rating
 */
export function saveRating(placeId, rating) {
  const ratings = getAllRatings()
  ratings[placeId] = {
    ...rating,
    visitedAt: rating.visitedAt || Date.now()
  }
  localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings))

  // Also save to legacy format for backward compatibility
  const legacy = JSON.parse(localStorage.getItem(LEGACY_RATINGS_KEY) || '{}')
  legacy[placeId] = {
    liked: rating.recommended,
    visitedAt: new Date(rating.visitedAt || Date.now()).toISOString(),
    category: rating.categoryKey
  }
  localStorage.setItem(LEGACY_RATINGS_KEY, JSON.stringify(legacy))
}

/**
 * Delete a rating
 * @param {string} placeId
 */
export function deleteRating(placeId) {
  const ratings = getAllRatings()
  delete ratings[placeId]
  localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings))

  // Also delete from legacy
  const legacy = JSON.parse(localStorage.getItem(LEGACY_RATINGS_KEY) || '{}')
  delete legacy[placeId]
  localStorage.setItem(LEGACY_RATINGS_KEY, JSON.stringify(legacy))
}

/**
 * Migrate legacy ratings to new format
 * @param {Object} legacyRatings
 * @returns {Object<string, PlaceRating>}
 */
function migrateLegacyRatings(legacyRatings) {
  const migrated = {}

  for (const [placeId, data] of Object.entries(legacyRatings)) {
    migrated[placeId] = {
      recommended: data.liked === true,
      vibe: null,
      noiseLevel: null,
      valueForMoney: null,
      review: null,
      visitedAt: data.visitedAt ? new Date(data.visitedAt).getTime() : Date.now(),
      categoryKey: data.category || null
    }
  }

  return migrated
}

/**
 * Get aggregate statistics for social proof
 * @returns {{ totalRatings: number, recommendedCount: number, recommendRate: number }}
 */
export function getAggregateStats() {
  const ratings = getAllRatings()
  const values = Object.values(ratings)

  const totalRatings = values.length
  const recommendedCount = values.filter(r => r.recommended).length
  const recommendRate = totalRatings > 0 ? (recommendedCount / totalRatings) * 100 : 0

  return {
    totalRatings,
    recommendedCount,
    recommendRate: Math.round(recommendRate)
  }
}

/**
 * Get ratings for a specific place (for social proof display)
 * Since we only store the user's own ratings, this returns aggregate mockup
 * In a real app, this would fetch from a server
 * @param {string} placeId
 * @returns {{ count: number, recommendRate: number, hasUserRating: boolean }}
 */
export function getPlaceSocialProof(placeId) {
  const ratings = getAllRatings()
  const userRating = ratings[placeId]

  // For MVP, we show if the user has rated it
  // In production, this would aggregate community ratings
  return {
    count: userRating ? 1 : 0,
    recommendRate: userRating?.recommended ? 100 : 0,
    hasUserRating: !!userRating,
    userRecommended: userRating?.recommended || null
  }
}

/**
 * Get user's recent reviews with place info
 * @param {number} limit - Max number of reviews to return
 * @returns {Array<{placeId: string, rating: PlaceRating}>}
 */
export function getRecentReviews(limit = 10) {
  const ratings = getAllRatings()

  return Object.entries(ratings)
    .map(([placeId, rating]) => ({ placeId, rating }))
    .filter(r => r.rating.review) // Only include entries with text reviews
    .sort((a, b) => b.rating.visitedAt - a.rating.visitedAt)
    .slice(0, limit)
}

/**
 * Vibe options for quick feedback
 */
export const VIBE_OPTIONS = [
  { value: 'relaxed', label: 'Relaxed', icon: '😌' },
  { value: 'lively', label: 'Lively', icon: '🎉' },
  { value: 'romantic', label: 'Romantic', icon: '💕' },
  { value: 'family', label: 'Family-friendly', icon: '👨‍👩‍👧' }
]

/**
 * Noise level options
 */
export const NOISE_OPTIONS = [
  { value: 'quiet', label: 'Quiet', icon: '🤫' },
  { value: 'moderate', label: 'Moderate', icon: '💬' },
  { value: 'loud', label: 'Loud', icon: '🔊' }
]

/**
 * Value for money options
 */
export const VALUE_OPTIONS = [
  { value: 'great', label: 'Great value', icon: '💰' },
  { value: 'fair', label: 'Fair price', icon: '👍' },
  { value: 'expensive', label: 'Pricey', icon: '💸' }
]

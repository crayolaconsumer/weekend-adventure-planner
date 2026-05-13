/**
 * Enhanced Ratings Storage
 *
 * Stores detailed user ratings with optional feedback and text reviews.
 * Migrates from legacy binary ratings format automatically.
 */

const RATINGS_KEY = 'roam_ratings_v2'
const LEGACY_RATINGS_KEY = 'roam_ratings'

export type Vibe = 'relaxed' | 'lively' | 'romantic' | 'family'
export type NoiseLevel = 'quiet' | 'moderate' | 'loud'
export type ValueForMoney = 'great' | 'fair' | 'expensive'

export interface PlaceRating {
  recommended: boolean
  vibe?: Vibe | null
  noiseLevel?: NoiseLevel | null
  valueForMoney?: ValueForMoney | null
  review?: string | null
  visitedAt?: number
  categoryKey?: string | null
}

export type RatingsMap = Record<string, PlaceRating>

interface LegacyRating {
  liked?: boolean
  visitedAt?: string
  category?: string | null
}

/** Get all ratings from storage */
export function getAllRatings(): RatingsMap {
  try {
    const ratings = localStorage.getItem(RATINGS_KEY)
    if (ratings) {
      return JSON.parse(ratings) as RatingsMap
    }

    // Migrate from legacy format if exists
    const legacy = localStorage.getItem(LEGACY_RATINGS_KEY)
    if (legacy) {
      const legacyRatings = JSON.parse(legacy) as Record<string, LegacyRating>
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

/** Get rating for a specific place */
export function getRating(placeId: string): PlaceRating | null {
  const ratings = getAllRatings()
  return ratings[placeId] || null
}

/** Save a rating for a place */
export function saveRating(placeId: string, rating: PlaceRating): void {
  const ratings = getAllRatings()
  ratings[placeId] = {
    ...rating,
    visitedAt: rating.visitedAt || Date.now(),
  }
  localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings))

  // Also save to legacy format for backward compatibility
  const legacy = JSON.parse(localStorage.getItem(LEGACY_RATINGS_KEY) || '{}') as Record<string, LegacyRating>
  legacy[placeId] = {
    liked: rating.recommended,
    visitedAt: new Date(rating.visitedAt || Date.now()).toISOString(),
    category: rating.categoryKey,
  }
  localStorage.setItem(LEGACY_RATINGS_KEY, JSON.stringify(legacy))
}

/** Delete a rating */
export function deleteRating(placeId: string): void {
  const ratings = getAllRatings()
  delete ratings[placeId]
  localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings))

  const legacy = JSON.parse(localStorage.getItem(LEGACY_RATINGS_KEY) || '{}') as Record<string, unknown>
  delete legacy[placeId]
  localStorage.setItem(LEGACY_RATINGS_KEY, JSON.stringify(legacy))
}

/** Migrate legacy ratings to new format */
function migrateLegacyRatings(legacyRatings: Record<string, LegacyRating>): RatingsMap {
  const migrated: RatingsMap = {}

  for (const [placeId, data] of Object.entries(legacyRatings)) {
    migrated[placeId] = {
      recommended: data.liked === true,
      vibe: null,
      noiseLevel: null,
      valueForMoney: null,
      review: null,
      visitedAt: data.visitedAt ? new Date(data.visitedAt).getTime() : Date.now(),
      categoryKey: data.category || null,
    }
  }

  return migrated
}

/** Get aggregate statistics for social proof */
export function getAggregateStats(): {
  totalRatings: number
  recommendedCount: number
  recommendRate: number
} {
  const ratings = getAllRatings()
  const values = Object.values(ratings)

  const totalRatings = values.length
  const recommendedCount = values.filter(r => r.recommended).length
  const recommendRate = totalRatings > 0 ? (recommendedCount / totalRatings) * 100 : 0

  return {
    totalRatings,
    recommendedCount,
    recommendRate: Math.round(recommendRate),
  }
}

/** Get ratings for a specific place (for social proof display) */
export function getPlaceSocialProof(placeId: string): {
  count: number
  recommendRate: number
  hasUserRating: boolean
  userRecommended: boolean | null
} {
  const ratings = getAllRatings()
  const userRating = ratings[placeId]

  return {
    count: userRating ? 1 : 0,
    recommendRate: userRating?.recommended ? 100 : 0,
    hasUserRating: !!userRating,
    userRecommended: userRating?.recommended ?? null,
  }
}

export interface VibeOption { value: Vibe; label: string; icon: string }
export interface NoiseOption { value: NoiseLevel; label: string; icon: string }
export interface ValueOption { value: ValueForMoney; label: string; icon: string }

export const VIBE_OPTIONS: VibeOption[] = [
  { value: 'relaxed', label: 'Relaxed', icon: '😌' },
  { value: 'lively', label: 'Lively', icon: '🎉' },
  { value: 'romantic', label: 'Romantic', icon: '💕' },
  { value: 'family', label: 'Family-friendly', icon: '👨‍👩‍👧' },
]

export const NOISE_OPTIONS: NoiseOption[] = [
  { value: 'quiet', label: 'Quiet', icon: '🤫' },
  { value: 'moderate', label: 'Moderate', icon: '💬' },
  { value: 'loud', label: 'Loud', icon: '🔊' },
]

export const VALUE_OPTIONS: ValueOption[] = [
  { value: 'great', label: 'Great value', icon: '💰' },
  { value: 'fair', label: 'Fair price', icon: '👍' },
  { value: 'expensive', label: 'Pricey', icon: '💸' },
]

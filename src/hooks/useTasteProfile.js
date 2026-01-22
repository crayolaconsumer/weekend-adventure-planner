/**
 * useTasteProfile Hook
 *
 * Provides access to the user's taste profile for personalization.
 * Rebuilds profile when relevant data changes.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  buildTasteProfile,
  getPersonalizationBoost,
  getMatchReason
} from '../utils/tasteProfile'

// Storage keys that affect taste profile
const PROFILE_KEYS = [
  'roam_interests',
  'roam_wishlist',
  'roam_visited_places',
  'roam_ratings_v2',
  'roam_free_only',
  'roam_accessibility'
]

/**
 * Hook to access user's taste profile
 *
 * @returns {{
 *   profile: Object,
 *   isPersonalized: boolean,
 *   getBoost: (place: Object) => number,
 *   getMatchReason: (place: Object) => string|null,
 *   refreshProfile: () => void
 * }}
 */
export function useTasteProfile() {
  const [profile, setProfile] = useState(() => buildTasteProfile())
  const [version, setVersion] = useState(0)

  // Rebuild profile when storage changes
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (PROFILE_KEYS.includes(e.key)) {
        setProfile(buildTasteProfile())
        setVersion(v => v + 1)
      }
    }

    // Listen for storage events (cross-tab)
    window.addEventListener('storage', handleStorageChange)

    // Also listen for custom profile update events (same-tab)
    const handleProfileUpdate = () => {
      setProfile(buildTasteProfile())
      setVersion(v => v + 1)
    }
    window.addEventListener('roam:profileUpdate', handleProfileUpdate)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('roam:profileUpdate', handleProfileUpdate)
    }
  }, [])

  // Memoized helper to get boost for a place
  const getBoost = useCallback((place) => {
    return getPersonalizationBoost(place, profile)
  }, [profile])

  // Memoized helper to get match reason
  const getMatchReasonForPlace = useCallback((place) => {
    return getMatchReason(place, profile)
  }, [profile])

  // Manual refresh function
  const refreshProfile = useCallback(() => {
    setProfile(buildTasteProfile())
    setVersion(v => v + 1)
  }, [])

  // Check if we have enough data for personalization
  const isPersonalized = useMemo(() => {
    return profile.dataQuality >= 20
  }, [profile.dataQuality])

  return {
    profile,
    isPersonalized,
    getBoost,
    getMatchReason: getMatchReasonForPlace,
    refreshProfile,
    version // Can be used as a dependency for effects
  }
}

/**
 * Trigger a profile update event (call after saving ratings, visiting places, etc.)
 */
export function triggerProfileUpdate() {
  window.dispatchEvent(new CustomEvent('roam:profileUpdate'))
}

/**
 * Get category label for display
 */
export function getCategoryLabel(categoryKey) {
  const labels = {
    food: 'Food & Drink',
    nature: 'Nature & Outdoors',
    culture: 'Arts & Culture',
    historic: 'History & Heritage',
    entertainment: 'Entertainment',
    nightlife: 'Nightlife',
    active: 'Active & Sports',
    unique: 'Hidden Gems',
    shopping: 'Markets & Shops'
  }
  return labels[categoryKey] || categoryKey
}

/**
 * Get vibe label for display
 */
export function getVibeLabel(vibe) {
  const labels = {
    relaxed: 'Relaxed',
    lively: 'Lively',
    romantic: 'Romantic',
    'family-friendly': 'Family-friendly'
  }
  return labels[vibe] || vibe
}

export default useTasteProfile

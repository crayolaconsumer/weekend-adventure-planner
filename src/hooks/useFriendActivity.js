/**
 * useFriendActivity Hook
 *
 * Fetches friend engagement data for places (saves, visits, recommendations).
 * Uses batch API to efficiently fetch data for multiple places at once.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'

// Get auth headers for API requests
function getAuthHeaders() {
  const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// Cache for friend activity data
const activityCache = new Map()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Hook for fetching friend activity for multiple places
 * @param {string[]} placeIds - Array of place IDs to fetch activity for
 * @returns {{ activityMap: Object, loading: boolean, error: string|null }}
 */
export function useFriendPlaceActivity(placeIds) {
  const { isAuthenticated } = useAuth()
  const [activityMap, setActivityMap] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Track the last fetch request to avoid race conditions
  const fetchIdRef = useRef(0)

  // Create a stable key for the placeIds array
  const placeIdsKey = placeIds?.join(',') || ''

  const fetchActivity = useCallback(async () => {
    if (!isAuthenticated || !placeIds || placeIds.length === 0) {
      setActivityMap({})
      return
    }

    // Check cache first
    const now = Date.now()
    const cachedData = {}
    const uncachedIds = []

    placeIds.forEach(id => {
      const cached = activityCache.get(id)
      if (cached && cached.timestamp > now - CACHE_TTL) {
        cachedData[id] = cached.data
      } else {
        uncachedIds.push(id)
      }
    })

    // If all data is cached, use it
    if (uncachedIds.length === 0) {
      setActivityMap(cachedData)
      return
    }

    // Increment fetch ID to track this request
    const currentFetchId = ++fetchIdRef.current

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/places/friend-activity?placeIds=${encodeURIComponent(uncachedIds.join(','))}`,
        {
          credentials: 'include',
          headers: getAuthHeaders()
        }
      )

      // Check if this is still the latest request
      if (currentFetchId !== fetchIdRef.current) {
        return
      }

      if (!response.ok) {
        throw new Error('Failed to fetch friend activity')
      }

      const freshData = await response.json()

      // Update cache with new data
      Object.entries(freshData).forEach(([id, data]) => {
        activityCache.set(id, { data, timestamp: Date.now() })
      })

      // Merge cached and fresh data
      const mergedData = { ...cachedData, ...freshData }
      setActivityMap(mergedData)
    } catch (err) {
      if (currentFetchId === fetchIdRef.current) {
        setError(err.message)
        // Still use cached data if available
        if (Object.keys(cachedData).length > 0) {
          setActivityMap(cachedData)
        }
      }
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setLoading(false)
      }
    }
  }, [isAuthenticated, placeIds])

  // Fetch when placeIds change
  useEffect(() => {
    fetchActivity()
  }, [placeIdsKey, fetchActivity])

  return { activityMap, loading, error }
}

/**
 * Hook for fetching friend activity for a single place
 * @param {string} placeId - Place ID to fetch activity for
 * @returns {{ activity: Object|null, loading: boolean, error: string|null }}
 */
export function useFriendActivity(placeId) {
  const placeIds = placeId ? [placeId] : []
  const { activityMap, loading, error } = useFriendPlaceActivity(placeIds)

  return {
    activity: placeId ? activityMap[placeId] || null : null,
    loading,
    error
  }
}

/**
 * Clear the friend activity cache
 * Call this when user's social graph changes (follow/unfollow)
 */
export function clearFriendActivityCache() {
  activityCache.clear()
}

export default {
  useFriendPlaceActivity,
  useFriendActivity,
  clearFriendActivityCache
}

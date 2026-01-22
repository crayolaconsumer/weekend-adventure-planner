/**
 * useTopContributions Hook
 *
 * Fetches and caches top contributions for multiple places.
 * Used to show community tips on swipe cards efficiently.
 */

import { useState, useEffect, useCallback, useRef } from 'react'

// In-memory cache for contributions
// Persists across component mounts within the same session
const contributionCache = new Map()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Fetch top contributions for a batch of place IDs
 */
async function fetchBatchContributions(placeIds) {
  if (!placeIds || placeIds.length === 0) return {}

  // Filter out already cached (and not expired) IDs
  const now = Date.now()
  const uncachedIds = placeIds.filter(id => {
    const cached = contributionCache.get(id)
    return !cached || (now - cached.timestamp > CACHE_TTL)
  })

  // If all are cached, return from cache
  if (uncachedIds.length === 0) {
    const result = {}
    for (const id of placeIds) {
      const cached = contributionCache.get(id)
      result[id] = cached?.data || null
    }
    return result
  }

  try {
    const response = await fetch(`/api/contributions/batch?placeIds=${uncachedIds.join(',')}`)

    if (!response.ok) {
      // Silently fail - API might not be configured in development
      // Cache empty results to avoid repeated failed requests
      for (const id of uncachedIds) {
        contributionCache.set(id, { data: null, timestamp: now })
      }
      return {}
    }

    const { contributions } = await response.json()

    // Cache the results
    for (const id of uncachedIds) {
      contributionCache.set(id, {
        data: contributions[id] || null,
        timestamp: now
      })
    }

    // Return all requested IDs (mix of newly fetched and cached)
    const result = {}
    for (const id of placeIds) {
      const cached = contributionCache.get(id)
      result[id] = cached?.data || null
    }
    return result
  } catch {
    // Silently fail - API might not be configured in development
    // Cache empty results to avoid repeated failed requests
    for (const id of uncachedIds) {
      contributionCache.set(id, { data: null, timestamp: now })
    }
    return {}
  }
}

/**
 * Hook to get top contributions for a list of places
 *
 * @param {string[]} placeIds - Array of place IDs to fetch contributions for
 * @returns {{ contributions: Object, loading: boolean, error: string|null }}
 */
export function useTopContributions(placeIds) {
  const [contributions, setContributions] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Track which IDs we've already fetched to avoid duplicate requests
  const fetchedIdsRef = useRef(new Set())

  const fetchContributions = useCallback(async () => {
    if (!placeIds || placeIds.length === 0) return

    // Filter to IDs we haven't fetched yet
    const newIds = placeIds.filter(id => !fetchedIdsRef.current.has(id))
    if (newIds.length === 0) return

    setLoading(true)
    setError(null)

    try {
      const result = await fetchBatchContributions(newIds)

      // Mark these IDs as fetched
      for (const id of newIds) {
        fetchedIdsRef.current.add(id)
      }

      // Merge with existing contributions
      setContributions(prev => ({ ...prev, ...result }))
    } catch {
      setError('Failed to load community tips')
    } finally {
      setLoading(false)
    }
  }, [placeIds])

  useEffect(() => {
    fetchContributions()
  }, [fetchContributions])

  return { contributions, loading, error }
}

/**
 * Hook to get top contribution for a single place
 * Convenience wrapper around useTopContributions
 *
 * @param {string} placeId - Place ID to fetch contribution for
 * @returns {{ contribution: Object|null, loading: boolean, error: string|null }}
 */
export function useTopContribution(placeId) {
  const { contributions, loading, error } = useTopContributions(
    placeId ? [placeId] : []
  )

  return {
    contribution: contributions[placeId] || null,
    loading,
    error
  }
}

/**
 * Clear the contribution cache
 * Useful after user creates a new contribution
 */
export function clearContributionCache(placeId) {
  if (placeId) {
    contributionCache.delete(placeId)
  } else {
    contributionCache.clear()
  }
}

export default useTopContributions

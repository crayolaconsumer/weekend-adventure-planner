/**
 * useRouting Hook
 *
 * Provides travel time calculations with caching for Plan page.
 * Integrates with OpenRouteService via routingService.
 */

import { useState, useCallback, useRef } from 'react'
import { getRoute, getRoutesBatch } from '../utils/routingService'

// Simple in-memory cache for route calculations
// Key format: "lat1,lng1-lat2,lng2-mode"
const routeCache = new Map()

function getCacheKey(from, to, mode) {
  // Round coordinates to 4 decimal places for cache efficiency
  const fromKey = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}`
  const toKey = `${to.lat.toFixed(4)},${to.lng.toFixed(4)}`
  return `${fromKey}-${toKey}-${mode}`
}

/**
 * Hook for fetching and caching route calculations
 */
export function useRouting() {
  const [isLoading, setIsLoading] = useState(false)
  const pendingRequests = useRef(new Map())

  /**
   * Get travel time between two points
   * Uses cache if available, otherwise fetches from API
   */
  const getTravelTime = useCallback(async (from, to, mode = 'walk') => {
    if (!from || !to) return null

    const cacheKey = getCacheKey(from, to, mode)

    // Check cache first
    if (routeCache.has(cacheKey)) {
      return routeCache.get(cacheKey)
    }

    // Check if there's already a pending request for this route
    if (pendingRequests.current.has(cacheKey)) {
      return pendingRequests.current.get(cacheKey)
    }

    // Create new request
    const requestPromise = (async () => {
      try {
        setIsLoading(true)
        const result = await getRoute(from, to, mode)

        // Cache the result
        routeCache.set(cacheKey, result)

        return result
      } finally {
        setIsLoading(false)
        pendingRequests.current.delete(cacheKey)
      }
    })()

    pendingRequests.current.set(cacheKey, requestPromise)
    return requestPromise
  }, [])

  /**
   * Get travel times for multiple legs at once
   * Useful for calculating entire itinerary
   */
  const getTravelTimesForItinerary = useCallback(async (stops, defaultMode = 'walk') => {
    if (!stops || stops.length < 2) return []

    const legs = []
    for (let i = 0; i < stops.length - 1; i++) {
      const from = stops[i]
      const to = stops[i + 1]
      const mode = from.transportToNext || defaultMode

      legs.push({
        from: { lat: from.lat, lng: from.lng },
        to: { lat: to.lat, lng: to.lng },
        mode,
      })
    }

    // Check cache for all legs first
    const results = []
    const uncachedLegs = []
    const uncachedIndices = []

    legs.forEach((leg, index) => {
      const cacheKey = getCacheKey(leg.from, leg.to, leg.mode)
      if (routeCache.has(cacheKey)) {
        results[index] = routeCache.get(cacheKey)
      } else {
        uncachedLegs.push(leg)
        uncachedIndices.push(index)
      }
    })

    // Fetch uncached routes
    if (uncachedLegs.length > 0) {
      setIsLoading(true)
      try {
        const fetchedResults = await getRoutesBatch(uncachedLegs)

        // Merge fetched results and cache them
        fetchedResults.forEach((result, i) => {
          const index = uncachedIndices[i]
          const leg = uncachedLegs[i]
          const cacheKey = getCacheKey(leg.from, leg.to, leg.mode)

          routeCache.set(cacheKey, result)
          results[index] = result
        })
      } finally {
        setIsLoading(false)
      }
    }

    return results
  }, [])

  /**
   * Clear the route cache
   * Useful if user changes location significantly
   */
  const clearCache = useCallback(() => {
    routeCache.clear()
  }, [])

  /**
   * Prefetch routes for an itinerary
   * Called when itinerary changes to warm the cache
   */
  const prefetchRoutes = useCallback(async (stops, defaultMode = 'walk') => {
    // Don't block UI, just warm the cache in background
    getTravelTimesForItinerary(stops, defaultMode).catch(() => {
      // Silently ignore prefetch errors
    })
  }, [getTravelTimesForItinerary])

  return {
    getTravelTime,
    getTravelTimesForItinerary,
    prefetchRoutes,
    clearCache,
    isLoading,
  }
}

export default useRouting

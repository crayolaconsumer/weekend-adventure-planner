/**
 * useRouting Hook
 *
 * Provides travel time calculations with caching for Plan page.
 * Free users: OpenRouteService via routingService (Haversine fallback).
 * Premium users: Google Maps Directions via /api/maps/directions, with the
 * free path as fallback. If the server rejects a Google request as
 * not-premium (403), `premiumDenied` flips to true so the page can show
 * the upgrade prompt.
 */

import { useState, useCallback, useRef, useMemo } from 'react'
import { getRoute, getRoutesBatch } from '../utils/routingService'
import { useSubscription } from './useSubscription'

// Simple in-memory cache for route calculations
// Key format: "lat1,lng1-lat2,lng2-mode-provider"
const routeCache = new Map()

function getCacheKey(from, to, mode, provider) {
  // Round coordinates to 4 decimal places for cache efficiency
  const fromKey = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}`
  const toKey = `${to.lat.toFixed(4)},${to.lng.toFixed(4)}`
  return `${fromKey}-${toKey}-${mode}-${provider}`
}

/**
 * Hook for fetching and caching route calculations
 */
export function useRouting() {
  const [isLoading, setIsLoading] = useState(false)
  const [premiumDenied, setPremiumDenied] = useState(false)
  const pendingRequests = useRef(new Map())
  const { hasFeature } = useSubscription()

  const useGoogle = hasFeature('googleDirections')
  const provider = useGoogle ? 'google' : 'standard'
  const routeOptions = useMemo(() => ({ useGoogle }), [useGoogle])

  // Flag a server-side premium rejection (stale client state, expired sub)
  const noteResult = useCallback((result) => {
    if (result?.premiumDenied) {
      setPremiumDenied(true)
    }
    return result
  }, [])

  /**
   * Get travel time between two points
   * Uses cache if available, otherwise fetches from API
   */
  const getTravelTime = useCallback(async (from, to, mode = 'walk') => {
    if (!from || !to) return null

    const cacheKey = getCacheKey(from, to, mode, provider)

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
        const result = noteResult(await getRoute(from, to, mode, routeOptions))

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
  }, [routeOptions, provider, noteResult])

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
      const cacheKey = getCacheKey(leg.from, leg.to, leg.mode, provider)
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
        const fetchedResults = await getRoutesBatch(uncachedLegs, routeOptions)

        // Merge fetched results and cache them
        fetchedResults.forEach((result, i) => {
          const index = uncachedIndices[i]
          const leg = uncachedLegs[i]
          const cacheKey = getCacheKey(leg.from, leg.to, leg.mode, provider)

          routeCache.set(cacheKey, noteResult(result))
          results[index] = result
        })
      } finally {
        setIsLoading(false)
      }
    }

    return results
  }, [routeOptions, provider, noteResult])

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

  /**
   * Reset the premium-denied flag (after the upgrade prompt is dismissed)
   */
  const clearPremiumDenied = useCallback(() => {
    setPremiumDenied(false)
  }, [])

  return {
    getTravelTime,
    getTravelTimesForItinerary,
    prefetchRoutes,
    clearCache,
    isLoading,
    // True when Google directions are used for this user
    usingGoogleDirections: useGoogle,
    // True when the server rejected a Google request as not-premium
    premiumDenied,
    clearPremiumDenied,
  }
}

export default useRouting

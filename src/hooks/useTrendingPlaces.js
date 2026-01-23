/**
 * useTrendingPlaces Hook
 *
 * Fetches trending places based on recent community activity
 */

import { useState, useEffect, useCallback } from 'react'

// Cache for trending data
let trendingCache = null
let cacheTimestamp = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export function useTrendingPlaces({ limit = 10, days = 7 } = {}) {
  const [trending, setTrending] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchTrending = useCallback(async () => {
    // Check cache
    const now = Date.now()
    if (trendingCache && now - cacheTimestamp < CACHE_TTL) {
      setTrending(trendingCache)
      setLoading(false)
      return
    }

    try {
      const res = await fetch(`/api/places/trending?limit=${limit}&days=${days}`)

      if (!res.ok) {
        // Silently fail - API might not be configured
        setTrending([])
        setLoading(false)
        return
      }

      const data = await res.json()
      const results = data.trending || []

      // Update cache
      trendingCache = results
      cacheTimestamp = now

      setTrending(results)
      setError(null)
    } catch {
      // Silently fail - feature is enhancement, not critical
      setTrending([])
    } finally {
      setLoading(false)
    }
  }, [limit, days])

  useEffect(() => {
    fetchTrending()
  }, [fetchTrending])

  return { trending, loading, error, refetch: fetchTrending }
}

export function clearTrendingCache() {
  trendingCache = null
  cacheTimestamp = 0
}

export default useTrendingPlaces

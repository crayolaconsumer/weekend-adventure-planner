import { useState, useEffect, useCallback } from 'react'

/**
 * Hook to fetch sponsored places for the discovery feed
 *
 * @param {Object} location - User's current location { lat, lng }
 * @param {string} category - Optional category filter
 * @returns {{ sponsoredPlaces: Array, loading: boolean, refresh: Function }}
 */
export function useSponsoredPlaces(location, category = null) {
  const [sponsoredPlaces, setSponsoredPlaces] = useState([])
  const [loading, setLoading] = useState(false)

  const fetchSponsored = useCallback(async () => {
    if (!location?.lat || !location?.lng) return

    setLoading(true)

    try {
      const params = new URLSearchParams({
        lat: location.lat.toString(),
        lng: location.lng.toString(),
        limit: '3'
      })

      if (category) {
        params.set('category', category)
      }

      const response = await fetch(`/api/ads/sponsored?${params}`)

      if (!response.ok) {
        throw new Error('Failed to fetch sponsored places')
      }

      const data = await response.json()
      setSponsoredPlaces(data.sponsored || [])
    } catch (error) {
      // Silently fail - don't show errors for ads
      console.warn('Failed to fetch sponsored places:', error)
      setSponsoredPlaces([])
    } finally {
      setLoading(false)
    }
  }, [location?.lat, location?.lng, category])

  // Fetch on mount and when location changes
  useEffect(() => {
    fetchSponsored()
  }, [fetchSponsored])

  return {
    sponsoredPlaces,
    loading,
    refresh: fetchSponsored
  }
}

export default useSponsoredPlaces

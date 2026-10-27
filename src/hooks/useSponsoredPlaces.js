import { useState, useEffect, useCallback } from 'react'
import { haversineKm } from '../../shared/geo.mjs'

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
      // No lat/lng in the URL: the server ignores location when picking ads,
      // so leaving it out lets every user share one edge-cached answer per
      // category. Distance is worked out here instead.
      const params = new URLSearchParams({ limit: '3' })

      if (category) {
        params.set('category', category)
      }

      const response = await fetch(`/api/ads/sponsored?${params}`)

      if (!response.ok) {
        throw new Error('Failed to fetch sponsored places')
      }

      const data = await response.json()
      setSponsoredPlaces((data.sponsored || []).map(sp => {
        const lat = Number(sp.place?.lat)
        const lng = Number(sp.place?.lng)
        if (!sp.place?.lat || !sp.place?.lng || !Number.isFinite(lat) || !Number.isFinite(lng)) return sp
        const distance = Math.round(haversineKm(location.lat, location.lng, lat, lng) * 10) / 10
        return { ...sp, place: { ...sp.place, distance } }
      }))
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

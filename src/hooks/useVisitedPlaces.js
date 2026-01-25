/**
 * useVisitedPlaces Hook
 *
 * Sync visited places to API when authenticated.
 * - Anonymous users: localStorage only
 * - Logged-in users: API (MySQL) + localStorage cache
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'

const STORAGE_KEY = 'roam_visited_places'

function getAuthToken() {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

function loadLocalVisited() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

export function useVisitedPlaces() {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [visitedPlaces, setVisitedPlaces] = useState(loadLocalVisited)
  const [loading, setLoading] = useState(true)
  // L8: Add loading state for individual operations
  const [saving, setSaving] = useState(false)
  const syncedRef = useRef(false)

  // Load visited places
  const loadVisited = useCallback(async () => {
    setLoading(true)

    try {
      if (isAuthenticated) {
        const token = getAuthToken()
        const response = await fetch('/api/users/visited', {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        })

        if (response.ok) {
          const data = await response.json()
          setVisitedPlaces(data.visited || [])
          // Cache in localStorage
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data.visited || []))
        } else {
          setVisitedPlaces(loadLocalVisited())
        }
      } else {
        setVisitedPlaces(loadLocalVisited())
      }
    } catch (err) {
      console.error('Error loading visited places:', err)
      setVisitedPlaces(loadLocalVisited())
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  // Sync local visited to API on login
  useEffect(() => {
    if (authLoading || !isAuthenticated || syncedRef.current) return

    const syncLocalVisited = async () => {
      const token = getAuthToken()
      if (!token) return

      const local = loadLocalVisited()
      if (local.length === 0) return

      try {
        // Sync each local visited place to API
        for (const item of local) {
          if (item.placeId) {
            await fetch('/api/users/visited', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
              },
              credentials: 'include',
              body: JSON.stringify({
                placeId: item.placeId,
                placeData: item.placeData || item,
                rating: item.rating
              })
            }).catch(() => {}) // Ignore individual errors
          }
        }
        syncedRef.current = true
      } catch (err) {
        console.error('Error syncing visited places:', err)
      }
    }

    syncLocalVisited()
  }, [isAuthenticated, authLoading])

  useEffect(() => {
    if (authLoading) return
    loadVisited()
  }, [isAuthenticated, authLoading, loadVisited])

  // Mark a place as visited
  const markVisited = useCallback(async (place, rating = null, userLocation = null) => {
    // L8: Set saving state
    setSaving(true)
    const placeId = place.id || place.placeId

    // Calculate distance if user location available
    let distance = null
    if (userLocation?.lat && userLocation?.lng && place.lat && place.lng) {
      const R = 6371 // Earth's radius in km
      const dLat = (place.lat - userLocation.lat) * Math.PI / 180
      const dLon = (place.lng - userLocation.lng) * Math.PI / 180
      const a =
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(userLocation.lat * Math.PI / 180) * Math.cos(place.lat * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2)
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
      distance = R * c
    }

    const visitedEntry = {
      placeId,
      placeData: place,
      visitedAt: Date.now(),
      rating,
      distance
    }

    // Optimistic local update
    setVisitedPlaces(prev => {
      const filtered = prev.filter(v => v.placeId !== placeId)
      return [visitedEntry, ...filtered]
    })

    // Update localStorage
    const local = loadLocalVisited()
    const filtered = local.filter(v => v.placeId !== placeId)
    localStorage.setItem(STORAGE_KEY, JSON.stringify([visitedEntry, ...filtered]))

    // Sync to API if authenticated
    if (isAuthenticated) {
      try {
        const token = getAuthToken()
        await fetch('/api/users/visited', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          credentials: 'include',
          body: JSON.stringify({
            placeId,
            placeData: place,
            rating
          })
        })
      } catch (err) {
        console.error('Error marking visited:', err)
      } finally {
        setSaving(false)
      }
    } else {
      setSaving(false)
    }
  }, [isAuthenticated])

  // Remove visited status
  const removeVisited = useCallback(async (placeId) => {
    // L8: Set saving state
    setSaving(true)
    // Optimistic local update
    setVisitedPlaces(prev => prev.filter(v => v.placeId !== placeId))

    // Update localStorage
    const local = loadLocalVisited()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local.filter(v => v.placeId !== placeId)))

    // Sync to API if authenticated
    if (isAuthenticated) {
      try {
        const token = getAuthToken()
        await fetch(`/api/users/visited?placeId=${encodeURIComponent(placeId)}`, {
          method: 'DELETE',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          credentials: 'include'
        })
      } catch (err) {
        console.error('Error removing visited:', err)
      } finally {
        setSaving(false)
      }
    } else {
      setSaving(false)
    }
  }, [isAuthenticated])

  // Check if a place is visited
  const isVisited = useCallback((placeId) => {
    return visitedPlaces.some(v => v.placeId === placeId)
  }, [visitedPlaces])

  return {
    visitedPlaces,
    loading: loading || authLoading,
    // L8: Expose saving state for UI feedback
    saving,
    markVisited,
    removeVisited,
    isVisited,
    refresh: loadVisited
  }
}

export default useVisitedPlaces

/**
 * useSavedPlaces Hook
 *
 * Unified interface for saved places regardless of auth state.
 * - Anonymous users: localStorage
 * - Logged-in users: API (MySQL)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'

const STORAGE_KEY = 'roam_wishlist'

// Helper to get auth token from storage (checks localStorage first, then sessionStorage)
const getToken = () => {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

export function useSavedPlaces() {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [places, setPlaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const loadedRef = useRef(false)
  // M14: AbortController ref for request cancellation
  const abortControllerRef = useRef(null)

  // Define loadPlaces before useEffect that uses it
  const loadPlaces = useCallback(async () => {
    // M14: Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    setLoading(true)
    setError(null)

    try {
      if (isAuthenticated) {
        // Fetch from API
        const token = getToken()
        const headers = token ? { Authorization: `Bearer ${token}` } : undefined

        const response = await fetch('/api/places/saved', {
          credentials: 'include',
          headers,
          signal: abortControllerRef.current.signal
        })

        if (!response.ok) {
          throw new Error('Failed to load saved places')
        }

        const data = await response.json()
        setPlaces(data.places || [])
      } else {
        // Load from localStorage
        const saved = localStorage.getItem(STORAGE_KEY)
        setPlaces(saved ? JSON.parse(saved) : [])
      }
    } catch (err) {
      // M14: Ignore abort errors
      if (err.name === 'AbortError') return
      // Silently fall back to localStorage (API might not be configured)
      const saved = localStorage.getItem(STORAGE_KEY)
      setPlaces(saved ? JSON.parse(saved) : [])
    } finally {
      setLoading(false)
      loadedRef.current = true
    }
  }, [isAuthenticated])

  // Load places on mount and when auth changes
  useEffect(() => {
    // Wait for auth to settle
    if (authLoading) return

    loadPlaces()

    // M14: Cleanup - cancel request on unmount
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [isAuthenticated, authLoading, loadPlaces])

  const savePlace = useCallback(async (place) => {
    const placeWithTimestamp = { ...place, savedAt: Date.now() }

    // Optimistic update - add to front of list
    setPlaces(prev => [placeWithTimestamp, ...prev.filter(p => p.id !== place.id)])

    // Analytics — fire-and-forget, no-op when PostHog isn't initialised
    import('../utils/analytics').then(({ track }) => track('place-saved', {
      placeId: place.id,
      category: place.category?.key || place.category || null,
    }))

    if (isAuthenticated) {
      try {
        const token = getToken()
        const response = await fetch('/api/places/saved', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          credentials: 'include',
          body: JSON.stringify({ place: placeWithTimestamp })
        })

        if (!response.ok) {
          throw new Error('Failed to save place')
        }
        return { success: true }
      } catch (err) {
        // Revert optimistic update
        setPlaces(prev => prev.filter(p => p.id !== place.id))
        // Save to localStorage as fallback
        const saved = localStorage.getItem(STORAGE_KEY)
        const current = saved ? JSON.parse(saved) : []
        const updated = [placeWithTimestamp, ...current.filter(p => p.id !== place.id)]
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
        // Re-add to state from localStorage fallback
        setPlaces(updated)
        return { success: false, error: err.message, fallback: true }
      }
    } else {
      // localStorage update
      const saved = localStorage.getItem(STORAGE_KEY)
      const current = saved ? JSON.parse(saved) : []
      const updated = [placeWithTimestamp, ...current.filter(p => p.id !== place.id)]
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return { success: true }
    }
  }, [isAuthenticated])

  const removePlace = useCallback(async (placeId) => {
    // Store removed place for potential rollback
    const removed = places.find(p => p.id === placeId)

    // Optimistic update
    setPlaces(prev => prev.filter(p => p.id !== placeId))

    if (isAuthenticated) {
      try {
        const token = getToken()
        const response = await fetch(`/api/places/saved?placeId=${encodeURIComponent(placeId)}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        })

        if (!response.ok) {
          throw new Error('Failed to remove place')
        }
        return { success: true }
      } catch (err) {
        // Rollback - add place back
        if (removed) {
          setPlaces(prev => [removed, ...prev])
        }
        return { success: false, error: err.message }
      }
    } else {
      // localStorage update
      const saved = localStorage.getItem(STORAGE_KEY)
      const current = saved ? JSON.parse(saved) : []
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current.filter(p => p.id !== placeId)))
      return { success: true }
    }
  }, [isAuthenticated, places])

  const isPlaceSaved = useCallback((placeId) => {
    return places.some(p => p.id === placeId)
  }, [places])

  const updatePlannedDate = useCallback(async (placeId, plannedDate) => {
    // Send the YYYY-MM-DD string in the USER's local timezone, not the
    // ISO UTC string. The cron that fires visit reminders compares
    // DATE(planned_date) = CURDATE() in UTC; if a UK user picks
    // "tomorrow" at 23:30 BST, plannedDate.toISOString() returns the
    // PREVIOUS day in UTC (22:30 UTC the day before midnight local),
    // so DATE(planned_date) is a day earlier than the user meant and
    // the reminder fires 24h too early.
    //
    // toLocaleDateString('en-CA', ...) yields ISO-shaped "YYYY-MM-DD"
    // in the user's local zone — exactly the date they meant.
    const localDateStr = plannedDate.toLocaleDateString('en-CA')

    // Optimistic update — keep the ISO form locally for any UI bits
    // that need to format/display the picked date, but persist the
    // local date string against the server.
    setPlaces(prev => prev.map(p =>
      p.id === placeId ? { ...p, plannedDate: plannedDate.toISOString() } : p
    ))

    if (isAuthenticated) {
      try {
        const token = getToken()
        const response = await fetch('/api/places/saved', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          credentials: 'include',
          body: JSON.stringify({
            placeId,
            plannedDate: localDateStr
          })
        })

        if (!response.ok) {
          throw new Error('Failed to update planned date')
        }
        return { success: true }
      } catch (err) {
        setPlaces(prev => prev.map(p =>
          p.id === placeId ? { ...p, plannedDate: null } : p
        ))
        return { success: false, error: err.message }
      }
    } else {
      const saved = localStorage.getItem(STORAGE_KEY)
      const current = saved ? JSON.parse(saved) : []
      const updated = current.map(p =>
        p.id === placeId ? { ...p, plannedDate: plannedDate.toISOString() } : p
      )
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return { success: true }
    }
  }, [isAuthenticated])

  return {
    places,
    loading: loading || authLoading,
    error,
    savePlace,
    removePlace,
    isPlaceSaved,
    updatePlannedDate,
    refresh: loadPlaces
  }
}

export default useSavedPlaces

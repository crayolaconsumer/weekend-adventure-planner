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

// visited_places.rating is a 1-5 TINYINT (CHECK 1-5). Older callers/cached data may
// pass a boolean recommend signal — coerce it before any write so we don't end up
// with rating=1 ("doesn't recommend") for what was actually a thumbs-up.
function coerceRating(rating) {
  if (typeof rating === 'boolean') return rating ? 5 : 1
  return rating
}

export function useVisitedPlaces() {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [visitedPlaces, setVisitedPlaces] = useState(loadLocalVisited)
  const [loading, setLoading] = useState(true)
  // L8: Add loading state for individual operations
  const [saving, setSaving] = useState(false)
  const syncedRef = useRef(false)
  // Cancel an in-flight load so a fast logout→login (or unmount) can't let a
  // stale request resolve and clobber state. Mirrors useSavedPlaces.
  const abortControllerRef = useRef(null)

  // Load visited places
  const loadVisited = useCallback(async () => {
    if (abortControllerRef.current) abortControllerRef.current.abort()
    abortControllerRef.current = new AbortController()
    const { signal } = abortControllerRef.current

    setLoading(true)

    try {
      if (isAuthenticated) {
        const token = getAuthToken()
        const response = await fetch('/api/users/visited', {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          signal
        })

        if (response.ok) {
          const data = await response.json()
          if (signal.aborted) return
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
      if (err.name === 'AbortError') return
      console.error('Error loading visited places:', err)
      setVisitedPlaces(loadLocalVisited())
    } finally {
      // A superseded/aborted request must not flip loading — the newer one owns it.
      if (!signal.aborted) setLoading(false)
    }
  }, [isAuthenticated])

  // Reset syncedRef when user logs out so re-sync happens on next login
  useEffect(() => {
    if (!isAuthenticated) {
      syncedRef.current = false
    }
  }, [isAuthenticated])

  // PRIVACY FIX: do NOT auto-sync local visited cache to the server on
  // login. That logic was designed for offline-first "mark visited while
  // logged out, then sync on login" — but in practice the localStorage
  // cache persisted across logout/login transitions, so when a user
  // signed into a SECOND account on the same device the previous user's
  // visited places got POSTed into the new account. We observed three
  // accounts ending up with identical 3-4 visits at distinct mass-sync
  // timestamps, each "leak" line up exactly with a fresh-login.
  //
  // New behaviour: source-of-truth for authenticated users is the
  // server. The localStorage cache is read-only for offline display and
  // gets refreshed from /api/users/visited via loadVisited(). It is
  // also wiped on logout (see authResetEffect below) so it never
  // crosses an account boundary again.
  useEffect(() => {
    if (authLoading || !isAuthenticated) return
    syncedRef.current = true
  }, [isAuthenticated, authLoading])

  // On logout, clear locally cached visited list so the next user on
  // this device starts fresh.
  useEffect(() => {
    if (!authLoading && !isAuthenticated && syncedRef.current) {
      localStorage.removeItem(STORAGE_KEY)
      setVisitedPlaces([])
      syncedRef.current = false
    }
  }, [isAuthenticated, authLoading])

  useEffect(() => {
    if (authLoading) return
    loadVisited()
    // Cancel the in-flight load on unmount / auth change.
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort()
    }
  }, [isAuthenticated, authLoading, loadVisited])

  // Mark a place as visited
  const markVisited = useCallback(async (place, rating = null, userLocation = null) => {
    // L8: Set saving state
    setSaving(true)
    const placeId = place.id || place.placeId

    rating = coerceRating(rating)

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

    // Preserve the original visited_at when this is an edit of an existing
    // visit (editing a review re-calls markVisited and must NOT re-stamp the
    // visit to "now"); only stamp now for a genuinely new visit.
    const makeEntry = (existingVisitedAt) => ({
      placeId,
      placeData: place,
      visitedAt: existingVisitedAt ?? Date.now(),
      rating,
      distance
    })

    // Optimistic local update
    setVisitedPlaces(prev => {
      const existing = prev.find(v => v.placeId === placeId)
      return [makeEntry(existing?.visitedAt), ...prev.filter(v => v.placeId !== placeId)]
    })

    // Analytics — fire-and-forget, no-op when PostHog isn't initialised
    import('../utils/analytics').then(({ track }) => track('place-visited', {
      placeId,
      recommended: rating != null ? rating > 3 : null,
      hasDistance: distance != null,
    }))

    // Update localStorage (preserve original visitedAt likewise)
    const local = loadLocalVisited()
    const existingLocal = local.find(v => v.placeId === placeId)
    const filtered = local.filter(v => v.placeId !== placeId)
    localStorage.setItem(STORAGE_KEY, JSON.stringify([makeEntry(existingLocal?.visitedAt), ...filtered]))

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

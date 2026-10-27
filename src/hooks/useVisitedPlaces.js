/**
 * useVisitedPlaces Hook
 *
 * Sync visited places to API when authenticated.
 * - Anonymous users: localStorage only
 * - Logged-in users: API (MySQL) + localStorage cache
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { haversineKm } from '../../shared/geo.mjs'
import { getAuthToken } from '../utils/authToken'
import { recordHappyMoment } from '../utils/reviewPrompt'
import { pending, writeOrQueue } from '../utils/outbox'

const STORAGE_KEY = 'roam_visited_places'

function loadLocalVisited() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

// Visits/unvisits still in the outbox, applied over the server list so a
// refresh can't drop a visit the server hasn't received yet.
function withPending(list) {
  let out = list
  for (const e of pending('visited:')) {
    const id = e.key.slice('visited:'.length)
    out = out.filter(v => String(v.placeId) !== id)
    if (e.method === 'POST' && e.local) out = [e.local, ...out]
  }
  return out
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
  // Visits made while a load is in flight (placeId -> entry, or null when
  // removed): put back over a server answer that may predate them
  const editsRef = useRef(new Map())

  // Load visited places
  const loadVisited = useCallback(async () => {
    if (abortControllerRef.current) abortControllerRef.current.abort()
    abortControllerRef.current = new AbortController()
    const { signal } = abortControllerRef.current
    editsRef.current = new Map()

    // Local-first: a signed-in user with a cached list sees it now; the
    // request below refreshes it in the background
    setLoading(!(isAuthenticated && loadLocalVisited().length > 0))

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
          let visited = withPending(data.visited || [])
          for (const [id, entry] of editsRef.current) {
            visited = visited.filter(v => String(v.placeId) !== id)
            if (entry) visited = [entry, ...visited]
          }
          setVisitedPlaces(visited)
          // Cache in localStorage
          localStorage.setItem(STORAGE_KEY, JSON.stringify(visited))
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
  // this device starts fresh. This effect owns resetting syncedRef: a
  // separate reset effect ran first in the same commit and cleared the
  // flag before this check, so the wipe never happened.
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
      distance = haversineKm(userLocation.lat, userLocation.lng, place.lat, place.lng)
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
    editsRef.current.set(String(placeId), makeEntry(existingLocal?.visitedAt))
    const filtered = local.filter(v => v.placeId !== placeId)
    localStorage.setItem(STORAGE_KEY, JSON.stringify([makeEntry(existingLocal?.visitedAt), ...filtered]))
    // Editing an existing review re-calls markVisited: only a new visit counts
    if (!existingLocal) recordHappyMoment('visit_marked')

    // Sync to API if authenticated
    if (isAuthenticated) {
      try {
        // Offline / hiccup: queued and retried later; the visit stays on screen
        const outcome = await writeOrQueue({
          key: `visited:${placeId}`,
          url: '/api/users/visited',
          method: 'POST',
          body: { placeId, placeData: place, rating },
          local: makeEntry(existingLocal?.visitedAt)
        })
        if (outcome === 'refused') console.error('Visit not recorded by the server')
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
    editsRef.current.set(String(placeId), null)
    setVisitedPlaces(prev => prev.filter(v => v.placeId !== placeId))

    // Update localStorage
    const local = loadLocalVisited()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local.filter(v => v.placeId !== placeId)))

    // Sync to API if authenticated
    if (isAuthenticated) {
      try {
        await writeOrQueue({
          key: `visited:${placeId}`,
          url: `/api/users/visited?placeId=${encodeURIComponent(placeId)}`,
          method: 'DELETE'
        })
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

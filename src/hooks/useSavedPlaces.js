/**
 * useSavedPlaces Hook
 *
 * Unified interface for saved places regardless of auth state.
 * - Anonymous users: localStorage
 * - Logged-in users: API (MySQL), shown first from a device cache of the last
 *   server list and revalidated in the background. Writes that fail for a
 *   reason that may pass (offline, 5xx) stay on screen and go to the outbox.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getAuthToken, readUserData, writeUserData } from '../utils/authToken'
import { recordHappyMoment } from '../utils/reviewPrompt'
import { pending, writeOrQueue } from '../utils/outbox'

const STORAGE_KEY = 'roam_wishlist'
// Signed-in device cache (never the anonymous list above), kept in the same
// storage as the session's token. AuthContext clears it on sign-out.
const CACHE_KEY = 'roam_saved_cache'

function readCache() {
  try {
    const list = JSON.parse(readUserData(CACHE_KEY) || 'null')
    return Array.isArray(list) ? list : null
  } catch { return null }
}

// Saves/unsaves still in the outbox, applied over a server or cached list so
// a background refresh can't drop a save the server hasn't received yet.
function withPending(list) {
  let out = list
  for (const e of pending('saved:')) {
    const id = e.key.slice('saved:'.length)
    out = out.filter(p => String(p.id) !== id)
    if (e.method === 'POST' && e.local) out = [e.local, ...out]
  }
  return out
}

export function useSavedPlaces() {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [places, setPlaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const loadedRef = useRef(false)
  // True once a signed-in list (cache or server) is on screen: until then
  // `places` may still hold the guest list and must not reach the cache
  const hydratedRef = useRef(false)
  // Saves/unsaves made while a load is in flight (id -> entry, or null for
  // removed). The server's answer may predate them, so they are put back over it.
  const editsRef = useRef(new Map())
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
    const cached = isAuthenticated ? readCache() : null
    hydratedRef.current = false
    editsRef.current = new Map()

    try {
      if (isAuthenticated) {
        // Local-first: show the last known list now, refresh below
        if (cached) {
          setPlaces(withPending(cached))
          setLoading(false)
          hydratedRef.current = true
        }
        const token = getAuthToken()
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
        let list = withPending(data.places || [])
        for (const [id, entry] of editsRef.current) {
          list = list.filter(p => String(p.id) !== id)
          if (entry) list = [entry, ...list]
        }
        setPlaces(list)
        hydratedRef.current = true
      } else {
        // Load from localStorage
        const saved = localStorage.getItem(STORAGE_KEY)
        setPlaces(saved ? JSON.parse(saved) : [])
      }
    } catch (err) {
      // M14: Ignore abort errors
      if (err.name === 'AbortError') return
      // Signed in: keep what is on screen (the cache, if any). The anonymous
      // list belongs to the next sign-in's migration, not to this account.
      if (isAuthenticated) return
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

  // Keep the device cache in step with what a signed-in user sees
  useEffect(() => {
    if (!isAuthenticated || authLoading || loading || !hydratedRef.current) return
    writeUserData(CACHE_KEY, JSON.stringify(places))
  }, [places, isAuthenticated, authLoading, loading])

  const savePlace = useCallback(async (place) => {
    const placeWithTimestamp = { ...place, savedAt: Date.now() }
    // Don't persist `distance`: it's computed from the user's location at save
    // time, so a stored copy is wrong the moment they move. Saved views
    // recompute it live from current location instead.
    delete placeWithTimestamp.distance

    // Optimistic update — add to front. Preserve the original savedAt when
    // re-saving an already-saved place so the "Saved" date doesn't jump to now
    // (server also preserves saved_at on conflict); only stamp now for a new save.
    let previous = null
    setPlaces(prev => {
      const existing = prev.find(p => p.id === place.id)
      previous = existing || null
      const entry = existing?.savedAt != null
        ? { ...placeWithTimestamp, savedAt: existing.savedAt }
        : placeWithTimestamp
      return [entry, ...prev.filter(p => p.id !== place.id)]
    })

    editsRef.current.set(String(place.id), placeWithTimestamp)
    // A re-save of a place already in the list is not a new happy moment
    const wasSaved = places.some(p => p.id === place.id)

    // Analytics — fire-and-forget, no-op when PostHog isn't initialised
    import('../utils/analytics').then(({ track }) => track('place-saved', {
      placeId: place.id,
      category: place.category?.key || place.category || null,
    }))

    if (isAuthenticated) {
      const outcome = await writeOrQueue({
        key: `saved:${place.id}`,
        url: '/api/places/saved',
        method: 'POST',
        body: { place: placeWithTimestamp },
        local: placeWithTimestamp
      })
      if (outcome === 'ok') {
        if (!wasSaved) recordHappyMoment('place_saved')
        return { success: true }
      }
      // Offline / server hiccup: the save stays and is retried later. Not a
      // confirmed success yet, so no happy moment; `fallback` tells callers
      // not to show an error.
      if (outcome === 'queued') return { success: false, queued: true, fallback: true }
      // Refused for good (e.g. free-tier cap): roll back only this place, or
      // restore the entry it replaced. Never touch localStorage while logged
      // in: that list belongs to the anonymous user and is migrated into
      // whichever account logs in next.
      editsRef.current.delete(String(place.id))
      setPlaces(prev => previous
        ? prev.map(p => (p.id === place.id ? previous : p))
        : prev.filter(p => p.id !== place.id))
      return { success: false, error: 'Failed to save place' }
    } else {
      // localStorage update (preserve original savedAt on re-save)
      const saved = localStorage.getItem(STORAGE_KEY)
      const current = saved ? JSON.parse(saved) : []
      const existingLocal = current.find(p => p.id === place.id)
      const localEntry = existingLocal?.savedAt != null
        ? { ...placeWithTimestamp, savedAt: existingLocal.savedAt }
        : placeWithTimestamp
      const updated = [localEntry, ...current.filter(p => p.id !== place.id)]
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      if (!existingLocal) recordHappyMoment('place_saved')
      return { success: true }
    }
  }, [isAuthenticated, places])

  const removePlace = useCallback(async (placeId) => {
    // Store removed place for potential rollback
    const removed = places.find(p => p.id === placeId)

    // Optimistic update
    editsRef.current.set(String(placeId), null)
    setPlaces(prev => prev.filter(p => p.id !== placeId))

    if (isAuthenticated) {
      const outcome = await writeOrQueue({
        key: `saved:${placeId}`,
        url: `/api/places/saved?placeId=${encodeURIComponent(placeId)}`,
        method: 'DELETE'
      })
      if (outcome === 'ok') return { success: true }
      if (outcome === 'queued') return { success: false, queued: true, fallback: true }
      // Refused for good: add the place back
      editsRef.current.delete(String(placeId))
      if (removed) {
        setPlaces(prev => [removed, ...prev])
      }
      return { success: false, error: 'Failed to remove place' }
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
        const token = getAuthToken()
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

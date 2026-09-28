/**
 * useSwipedPlaces Hook
 *
 * Sync swiped places (likes/skips) to API when authenticated.
 * - Anonymous users: localStorage only
 * - Logged-in users: API (MySQL)
 *
 * Uses batch API to prevent rate limiting (max 50 swipes per request)
 */

import { useCallback, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getAuthToken } from '../utils/authToken'
import { mergeSeen, setSeenOwner } from '../utils/seenPlaces'

const STORAGE_KEY = 'roam_not_interested'
const BATCH_SIZE = 50 // API limit per request
const DEBOUNCE_DELAY = 2000 // 2 seconds debounce for real-time swipes
const MAX_LOCAL_SKIPS = 50 // Keep localStorage small
// The server's swipes are read once per signed-in user per page session
// (not per mount), so swipes from other devices leave the deck without a
// call per visit. A different user signing in gets their own read.
const SERVER_SEEN_LIMIT = 500 // api/places/swiped.js caps GET at 500
let serverSeenFor = null

/**
 * GET the signed-in user's swipes once per session and merge them into the
 * seen store. Resolves to the number of places newly added (0 on failure:
 * the deck never waits on or breaks over this call).
 */
export async function mergeServerSwipes(userId, token = getAuthToken()) {
  if (userId == null || serverSeenFor === String(userId) || !token) return 0
  serverSeenFor = String(userId)
  try {
    const res = await fetch(`/api/places/swiped?limit=${SERVER_SEEN_LIMIT}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include'
    })
    if (!res.ok) return 0
    const data = await res.json()
    // Signed out or switched user while the GET was in flight: not theirs
    if (serverSeenFor !== String(userId)) return 0
    const tag = action => item => ({ ...item, action })
    return mergeSeen([
      ...(Array.isArray(data?.likes) ? data.likes.map(tag('like')) : []),
      ...(Array.isArray(data?.skips) ? data.skips.map(tag('skip')) : [])
    ])
  } catch {
    return 0
  }
}

/** For tests: allow another once-per-session GET. */
export function resetServerSeenForTests() {
  serverSeenFor = null
}

/**
 * Record a skip in the local "not interested" list, the one writer for
 * STORAGE_KEY. Entries are { placeId, categoryKey, placeType, timestamp }
 * (tasteProfile reads categoryKey + timestamp). Re-skipping moves the place
 * to the end; only the newest MAX_LOCAL_SKIPS are kept.
 */
export function recordLocalSkip(placeId, details = {}) {
  let existing = []
  try {
    existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(existing)) existing = []
  } catch {
    // Corrupt value: start fresh
  }
  const next = existing
    .filter(item => item && item.placeId !== placeId)
    .concat({ placeId, categoryKey: details.categoryKey, placeType: details.placeType, timestamp: Date.now() })
    .slice(-MAX_LOCAL_SKIPS)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch (err) {
    console.error('Error updating local swipes:', err)
  }
}

export function useSwipedPlaces({ onSeenChange } = {}) {
  const { isAuthenticated, loading: authLoading, user } = useAuth()
  const userId = isAuthenticated ? (user?.id ?? null) : null
  const onSeenChangeRef = useRef(onSeenChange)
  onSeenChangeRef.current = onSeenChange

  // The seen store follows the signed-in user (anonymous merges in on
  // sign-in); then swipes made on other devices are merged from the server
  useEffect(() => {
    if (authLoading) return
    if (setSeenOwner(userId)) onSeenChangeRef.current?.()
    if (userId == null) {
      serverSeenFor = null // signed out: the next sign-in reads its own list
      return
    }
    mergeServerSwipes(userId).then(added => {
      if (added > 0) onSeenChangeRef.current?.()
    })
  }, [userId, authLoading])
  const syncedRef = useRef(false)
  const pendingSwipesRef = useRef([]) // Queue for debounced swipes
  const debounceTimerRef = useRef(null)
  const flushingRef = useRef(false) // Mutex to prevent concurrent flushes

  // Sync local swipes to API on login (using batch endpoint)
  useEffect(() => {
    if (authLoading || !isAuthenticated || syncedRef.current) return

    const syncLocalSwipes = async () => {
      const token = getAuthToken()
      if (!token) return

      // Get local not interested places
      const local = localStorage.getItem(STORAGE_KEY)
      if (!local) return

      try {
        const notInterested = JSON.parse(local)
        if (!Array.isArray(notInterested) || notInterested.length === 0) return

        // Filter to valid swipes with placeId
        const validSwipes = notInterested
          .filter(item => item.placeId)
          .map(item => ({ placeId: item.placeId, action: 'skip' }))

        if (validSwipes.length === 0) return

        // Split into batches of BATCH_SIZE
        const batches = []
        for (let i = 0; i < validSwipes.length; i += BATCH_SIZE) {
          batches.push(validSwipes.slice(i, i + BATCH_SIZE))
        }

        // Send batches sequentially to avoid rate limiting
        for (const batch of batches) {
          await fetch('/api/places/swiped', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            credentials: 'include',
            body: JSON.stringify({ swipes: batch })
          }).catch(() => {}) // Ignore errors - best effort sync
        }

        syncedRef.current = true
      } catch (err) {
        console.error('Error syncing swipes:', err)
      }
    }

    syncLocalSwipes()
  }, [isAuthenticated, authLoading])

  // Flush pending swipes to API as a batch
  const flushPendingSwipes = useCallback(async () => {
    // Mutex: prevent concurrent flushes that could cause race conditions
    if (flushingRef.current) return

    // Clear debounce timer inside flush to prevent race between timer and manual flush
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }

    const swipes = pendingSwipesRef.current
    if (swipes.length === 0) return

    // Acquire lock and atomically clear queue
    flushingRef.current = true
    pendingSwipesRef.current = []

    const token = getAuthToken()
    if (!token) {
      flushingRef.current = false
      return
    }

    try {
      await fetch('/api/places/swiped', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        credentials: 'include',
        body: JSON.stringify({ swipes })
      })
    } catch (err) {
      console.error('Error syncing swipes batch:', err)
    } finally {
      flushingRef.current = false
    }
  }, [])

  const recordSwipe = useCallback(async (placeId, action, details) => {
    // Always update localStorage for skip/not interested (for personalization)
    // This is kept regardless of auth state for local recommendations
    // (The deck's seen store is written by Discover's swipe handler, for
    // every direction, before any early return.)
    if (action === 'skip') recordLocalSkip(placeId, details)

    // Queue swipe for batched API sync if authenticated
    if (isAuthenticated) {
      // Add to pending queue (dedupe by placeId, keep latest action)
      const existingIdx = pendingSwipesRef.current.findIndex(s => s.placeId === placeId)
      if (existingIdx >= 0) {
        pendingSwipesRef.current[existingIdx].action = action
      } else {
        pendingSwipesRef.current.push({ placeId, action })
      }

      // Flush immediately if batch is full, otherwise debounce
      if (pendingSwipesRef.current.length >= BATCH_SIZE) {
        // flushPendingSwipes clears the debounce timer internally
        await flushPendingSwipes()
      } else {
        // Debounce: flush after DEBOUNCE_DELAY of inactivity
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
        }
        debounceTimerRef.current = setTimeout(flushPendingSwipes, DEBOUNCE_DELAY)
      }
    }
  }, [isAuthenticated, flushPendingSwipes])

  // Flush pending swipes when page becomes hidden or on unmount
  // Using visibilitychange is more reliable than unmount for page navigations
  // Note: sendBeacon can't send Authorization headers, so we use fetch while page is still visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && pendingSwipesRef.current.length > 0) {
        // Flush immediately when page becomes hidden (before potential unload)
        // Use fetch with keepalive - works because we're still in the page lifecycle
        const token = getAuthToken()
        if (token && pendingSwipesRef.current.length > 0) {
          const swipes = [...pendingSwipesRef.current]
          pendingSwipesRef.current = []
          fetch('/api/places/swiped', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            credentials: 'include',
            body: JSON.stringify({ swipes }),
            keepalive: true // Allows request to outlive page
          }).catch(() => {}) // Best effort
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      // Also try to flush on unmount (component unmount, not page unload)
      // This handles in-app navigation where visibilitychange doesn't fire
      if (pendingSwipesRef.current.length > 0 && isAuthenticated) {
        flushPendingSwipes()
      }
    }
  }, [isAuthenticated, flushPendingSwipes])

  return { recordSwipe }
}

export default useSwipedPlaces

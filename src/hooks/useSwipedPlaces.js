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

const STORAGE_KEY = 'roam_not_interested'
const BATCH_SIZE = 50 // API limit per request
const DEBOUNCE_DELAY = 2000 // 2 seconds debounce for real-time swipes

function getAuthToken() {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

export function useSwipedPlaces() {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const syncedRef = useRef(false)
  const pendingSwipesRef = useRef([]) // Queue for debounced swipes
  const debounceTimerRef = useRef(null)

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
    const swipes = pendingSwipesRef.current
    if (swipes.length === 0) return

    pendingSwipesRef.current = [] // Clear queue
    const token = getAuthToken()
    if (!token) return

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
    }
  }, [])

  const recordSwipe = useCallback(async (placeId, action) => {
    // Always update localStorage for skip/not interested (for personalization)
    // This is kept regardless of auth state for local recommendations
    if (action === 'skip') {
      try {
        const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
        if (!existing.some(item => item.placeId === placeId)) {
          existing.push({ placeId, skippedAt: Date.now() })
          localStorage.setItem(STORAGE_KEY, JSON.stringify(existing))
        }
      } catch (err) {
        console.error('Error updating local swipes:', err)
      }
    }

    // Queue swipe for batched API sync if authenticated
    if (isAuthenticated) {
      // Add to pending queue (dedupe by placeId, keep latest action)
      const existingIdx = pendingSwipesRef.current.findIndex(s => s.placeId === placeId)
      if (existingIdx >= 0) {
        pendingSwipesRef.current[existingIdx].action = action
      } else {
        pendingSwipesRef.current.push({ placeId, action })
      }

      // Debounce: flush after DEBOUNCE_DELAY of inactivity
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = setTimeout(flushPendingSwipes, DEBOUNCE_DELAY)

      // Also flush immediately if batch is full
      if (pendingSwipesRef.current.length >= BATCH_SIZE) {
        clearTimeout(debounceTimerRef.current)
        await flushPendingSwipes()
      }
    }
  }, [isAuthenticated, flushPendingSwipes])

  // Flush pending swipes on unmount (e.g., page navigation)
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      // Flush synchronously on unmount using sendBeacon for reliability
      if (pendingSwipesRef.current.length > 0 && isAuthenticated) {
        const token = getAuthToken()
        if (token) {
          const blob = new Blob(
            [JSON.stringify({ swipes: pendingSwipesRef.current })],
            { type: 'application/json' }
          )
          navigator.sendBeacon('/api/places/swiped', blob)
        }
      }
    }
  }, [isAuthenticated])

  return { recordSwipe }
}

export default useSwipedPlaces

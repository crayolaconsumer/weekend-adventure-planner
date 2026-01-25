/**
 * useSwipedPlaces Hook
 *
 * Sync swiped places (likes/skips) to API when authenticated.
 * - Anonymous users: localStorage only
 * - Logged-in users: API (MySQL)
 */

import { useCallback, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'

const STORAGE_KEY = 'roam_not_interested'

function getAuthToken() {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

export function useSwipedPlaces() {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const syncedRef = useRef(false)

  // Sync local swipes to API on login
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

        // Batch sync to API (just the place IDs that were skipped)
        // This is a best-effort sync - we don't block on it
        for (const item of notInterested) {
          if (item.placeId) {
            await fetch('/api/places/swiped', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
              },
              credentials: 'include',
              body: JSON.stringify({ placeId: item.placeId, action: 'skip' })
            }).catch(() => {}) // Ignore errors
          }
        }

        syncedRef.current = true
      } catch (err) {
        console.error('Error syncing swipes:', err)
      }
    }

    syncLocalSwipes()
  }, [isAuthenticated, authLoading])

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

    // Sync to API if authenticated
    if (isAuthenticated) {
      try {
        const token = getAuthToken()
        await fetch('/api/places/swiped', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          credentials: 'include',
          body: JSON.stringify({ placeId, action })
        })
      } catch (err) {
        console.error('Error recording swipe:', err)
      }
    }
  }, [isAuthenticated])

  return { recordSwipe }
}

export default useSwipedPlaces

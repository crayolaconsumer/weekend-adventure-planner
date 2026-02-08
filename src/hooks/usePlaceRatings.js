/**
 * usePlaceRatings Hook
 *
 * Sync place ratings to API when authenticated.
 * - Anonymous users: localStorage only (via ratingsStorage.js)
 * - Logged-in users: API (MySQL) + localStorage cache
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getAllRatings, saveRating as saveLocalRating, deleteRating as deleteLocalRating } from '../utils/ratingsStorage'

function getAuthToken() {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

export function usePlaceRatings() {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [ratings, setRatings] = useState({})
  const [loading, setLoading] = useState(true)
  const syncedRef = useRef(false)

  // Load ratings
  const loadRatings = useCallback(async () => {
    setLoading(true)

    try {
      if (isAuthenticated) {
        const token = getAuthToken()
        const response = await fetch('/api/places/ratings', {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        })

        if (response.ok) {
          const data = await response.json()
          // Convert array to object keyed by placeId
          const ratingsMap = {}
          for (const r of data.ratings || []) {
            ratingsMap[r.placeId] = r
          }
          setRatings(ratingsMap)
        } else {
          setRatings(getAllRatings())
        }
      } else {
        setRatings(getAllRatings())
      }
    } catch (err) {
      console.error('Error loading ratings:', err)
      setRatings(getAllRatings())
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  // Sync local ratings to API on login
  useEffect(() => {
    if (authLoading || !isAuthenticated || syncedRef.current) return

    const syncLocalRatings = async () => {
      const token = getAuthToken()
      if (!token) return

      const local = getAllRatings()
      if (Object.keys(local).length === 0) return

      try {
        for (const [placeId, rating] of Object.entries(local)) {
          await fetch('/api/places/ratings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            credentials: 'include',
            body: JSON.stringify({
              placeId,
              rating: rating.recommended ? 5 : 1,
              review: rating.review
            })
          }).catch(() => {})
        }
        syncedRef.current = true
      } catch (err) {
        console.error('Error syncing ratings:', err)
      }
    }

    syncLocalRatings()
  }, [isAuthenticated, authLoading])

  useEffect(() => {
    if (authLoading) return
    loadRatings()
  }, [isAuthenticated, authLoading, loadRatings])

  // Rate a place
  const ratePlace = useCallback(async (placeId, ratingData) => {
    const { recommended, review, vibe, noiseLevel, valueForMoney, categoryKey } = ratingData

    // Always save to localStorage (for local recommendations)
    const localRating = {
      recommended: recommended === true,
      vibe: vibe || null,
      noiseLevel: noiseLevel || null,
      valueForMoney: valueForMoney || null,
      review: review || null,
      visitedAt: Date.now(),
      categoryKey: categoryKey || null
    }
    saveLocalRating(placeId, localRating)

    // Optimistic update
    setRatings(prev => ({
      ...prev,
      [placeId]: {
        placeId,
        rating: recommended ? 5 : 1,
        review: review || null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    }))

    // Sync to API if authenticated
    // API uses UPSERT so no need to check for existing or handle 409
    if (isAuthenticated) {
      try {
        const token = getAuthToken()
        await fetch('/api/places/ratings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          credentials: 'include',
          body: JSON.stringify({
            placeId,
            rating: recommended ? 5 : 1,
            review: review || null
          })
        })
      } catch (err) {
        console.error('Error saving rating:', err)
      }
    }

    return { success: true }
  }, [isAuthenticated])

  // Delete a rating
  const deleteRating = useCallback(async (placeId) => {
    // Remove from localStorage
    deleteLocalRating(placeId)

    // Optimistic update
    setRatings(prev => {
      const updated = { ...prev }
      delete updated[placeId]
      return updated
    })

    // Sync to API if authenticated
    if (isAuthenticated) {
      try {
        const token = getAuthToken()
        await fetch(`/api/places/ratings?placeId=${encodeURIComponent(placeId)}`, {
          method: 'DELETE',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          credentials: 'include'
        })
      } catch (err) {
        console.error('Error deleting rating:', err)
      }
    }
  }, [isAuthenticated])

  // Get rating for a place
  const getRating = useCallback((placeId) => {
    return ratings[placeId] || null
  }, [ratings])

  // Check if place is rated
  const isRated = useCallback((placeId) => {
    return placeId in ratings
  }, [ratings])

  return {
    ratings,
    loading: loading || authLoading,
    ratePlace,
    deleteRating,
    getRating,
    isRated,
    refresh: loadRatings
  }
}

export default usePlaceRatings

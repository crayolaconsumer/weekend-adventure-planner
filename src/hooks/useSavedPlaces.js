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

export function useSavedPlaces() {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [places, setPlaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const loadedRef = useRef(false)

  // Define loadPlaces before useEffect that uses it
  const loadPlaces = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      if (isAuthenticated) {
        // Fetch from API
        const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
        const headers = token ? { Authorization: `Bearer ${token}` } : undefined

        const response = await fetch('/api/places/saved', {
          credentials: 'include',
          headers
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
      console.error('Failed to load places:', err)
      setError(err.message)
      // Fallback to localStorage on API error
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
  }, [isAuthenticated, authLoading, loadPlaces])

  const savePlace = useCallback(async (place) => {
    const placeWithTimestamp = { ...place, savedAt: Date.now() }

    // Optimistic update - add to front of list
    setPlaces(prev => [placeWithTimestamp, ...prev.filter(p => p.id !== place.id)])

    if (isAuthenticated) {
      try {
        const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
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
      } catch (err) {
        console.error('Failed to save place:', err)
        // Revert on failure
        setPlaces(prev => prev.filter(p => p.id !== place.id))
        throw err
      }
    } else {
      // localStorage update
      const saved = localStorage.getItem(STORAGE_KEY)
      const current = saved ? JSON.parse(saved) : []
      const updated = [placeWithTimestamp, ...current.filter(p => p.id !== place.id)]
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    }
  }, [isAuthenticated])

  const removePlace = useCallback(async (placeId) => {
    // Store removed place for potential rollback
    const removed = places.find(p => p.id === placeId)

    // Optimistic update
    setPlaces(prev => prev.filter(p => p.id !== placeId))

    if (isAuthenticated) {
      try {
        const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
        const response = await fetch(`/api/places/saved?placeId=${encodeURIComponent(placeId)}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        })

        if (!response.ok) {
          throw new Error('Failed to remove place')
        }
      } catch (err) {
        console.error('Failed to remove place:', err)
        // Revert on failure
        if (removed) {
          setPlaces(prev => [...prev, removed])
        }
        throw err
      }
    } else {
      // localStorage update
      const saved = localStorage.getItem(STORAGE_KEY)
      const current = saved ? JSON.parse(saved) : []
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current.filter(p => p.id !== placeId)))
    }
  }, [isAuthenticated, places])

  const isPlaceSaved = useCallback((placeId) => {
    return places.some(p => p.id === placeId)
  }, [places])

  return {
    places,
    loading: loading || authLoading,
    error,
    savePlace,
    removePlace,
    isPlaceSaved,
    refresh: loadPlaces
  }
}

export default useSavedPlaces

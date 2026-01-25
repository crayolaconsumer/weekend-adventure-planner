/**
 * useUserPreferences Hook
 *
 * Unified interface for user preferences regardless of auth state.
 * - Anonymous users: localStorage
 * - Logged-in users: API (MySQL)
 */

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'

// localStorage keys for anonymous users
const STORAGE_KEYS = {
  travelMode: 'roam_travel_mode',
  freeOnly: 'roam_free_only',
  accessibilityMode: 'roam_accessibility',
  openOnly: 'roam_open_only',
  localsPicks: 'roam_locals_picks',
  offPeak: 'roam_off_peak',
  eventsRadius: 'roam_events_radius',
  eventsSort: 'roam_events_sort',
  eventsHideSoldOut: 'roam_events_hide_sold_out',
  eventsHideSeen: 'roam_events_hide_seen',
  interests: 'roam_interests',
  distanceUnit: 'roam_distance_unit'
}

function getAuthToken() {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

function loadLocalPreferences() {
  return {
    travelMode: localStorage.getItem(STORAGE_KEYS.travelMode) || 'walking',
    freeOnly: localStorage.getItem(STORAGE_KEYS.freeOnly) === 'true',
    accessibilityMode: localStorage.getItem(STORAGE_KEYS.accessibilityMode) === 'true',
    openOnly: localStorage.getItem(STORAGE_KEYS.openOnly) === 'true',
    localsPicks: localStorage.getItem(STORAGE_KEYS.localsPicks) === 'true',
    offPeak: localStorage.getItem(STORAGE_KEYS.offPeak) === 'true',
    eventsRadius: parseInt(localStorage.getItem(STORAGE_KEYS.eventsRadius) || '25', 10),
    eventsSort: localStorage.getItem(STORAGE_KEYS.eventsSort) || 'recommended',
    eventsHideSoldOut: localStorage.getItem(STORAGE_KEYS.eventsHideSoldOut) === 'true',
    eventsHideSeen: localStorage.getItem(STORAGE_KEYS.eventsHideSeen) === 'true',
    interests: JSON.parse(localStorage.getItem(STORAGE_KEYS.interests) || '[]'),
    distanceUnit: localStorage.getItem(STORAGE_KEYS.distanceUnit) || 'km'
  }
}

function saveLocalPreference(key, value) {
  if (typeof value === 'boolean') {
    localStorage.setItem(STORAGE_KEYS[key], value.toString())
  } else if (Array.isArray(value) || typeof value === 'object') {
    localStorage.setItem(STORAGE_KEYS[key], JSON.stringify(value))
  } else {
    localStorage.setItem(STORAGE_KEYS[key], String(value))
  }
}

export function useUserPreferences() {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [preferences, setPreferences] = useState(loadLocalPreferences)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadPreferences = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      if (isAuthenticated) {
        const token = getAuthToken()
        const response = await fetch('/api/users/preferences', {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        })

        if (!response.ok) {
          throw new Error('Failed to load preferences')
        }

        const data = await response.json()
        setPreferences(data.preferences)
      } else {
        setPreferences(loadLocalPreferences())
      }
    } catch (err) {
      console.error('Error loading preferences:', err)
      setPreferences(loadLocalPreferences())
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (authLoading) return
    loadPreferences()
  }, [isAuthenticated, authLoading, loadPreferences])

  const updatePreference = useCallback(async (key, value) => {
    // Optimistic update
    setPreferences(prev => ({ ...prev, [key]: value }))

    if (isAuthenticated) {
      try {
        const token = getAuthToken()
        const response = await fetch('/api/users/preferences', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          credentials: 'include',
          body: JSON.stringify({ [key]: value })
        })

        if (!response.ok) {
          throw new Error('Failed to update preference')
        }
        return true
      } catch (err) {
        console.error('Error updating preference:', err)
        // Fall back to localStorage
        saveLocalPreference(key, value)
        return false
      }
    } else {
      saveLocalPreference(key, value)
      return true
    }
  }, [isAuthenticated])

  const updatePreferences = useCallback(async (updates) => {
    // Optimistic update
    setPreferences(prev => ({ ...prev, ...updates }))

    if (isAuthenticated) {
      try {
        const token = getAuthToken()
        const response = await fetch('/api/users/preferences', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          credentials: 'include',
          body: JSON.stringify(updates)
        })

        if (!response.ok) {
          throw new Error('Failed to update preferences')
        }
        return true
      } catch (err) {
        console.error('Error updating preferences:', err)
        // Fall back to localStorage
        Object.entries(updates).forEach(([key, value]) => {
          saveLocalPreference(key, value)
        })
        return false
      }
    } else {
      Object.entries(updates).forEach(([key, value]) => {
        saveLocalPreference(key, value)
      })
      return true
    }
  }, [isAuthenticated])

  return {
    preferences,
    loading: loading || authLoading,
    error,
    updatePreference,
    updatePreferences,
    refresh: loadPreferences
  }
}

export default useUserPreferences

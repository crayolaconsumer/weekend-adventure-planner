/**
 * DistanceContext
 *
 * Provides distance unit preference (km/mi) throughout the app.
 * Includes a memoized formatDistance function that components can use directly.
 */

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from './AuthContext'
import { formatDistance as formatDistanceUtil } from '../utils/distanceUtils'

const DistanceContext = createContext(null)

const STORAGE_KEY = 'roam_distance_unit'

function getAuthToken() {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

export function DistanceProvider({ children }) {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [distanceUnit, setDistanceUnitState] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) || 'km'
  })
  const [loading, setLoading] = useState(true)

  // Load preference from API for authenticated users
  useEffect(() => {
    if (authLoading) return

    const loadPreference = async () => {
      if (isAuthenticated) {
        try {
          const token = getAuthToken()
          const response = await fetch('/api/users/preferences', {
            credentials: 'include',
            headers: token ? { Authorization: `Bearer ${token}` } : undefined
          })

          if (response.ok) {
            const data = await response.json()
            const unit = data.preferences?.distanceUnit || 'km'
            setDistanceUnitState(unit)
            localStorage.setItem(STORAGE_KEY, unit)
          }
        } catch (err) {
          console.error('Error loading distance preference:', err)
        }
      }
      setLoading(false)
    }

    loadPreference()
  }, [isAuthenticated, authLoading])

  // Update preference (localStorage + API for authenticated users)
  const setDistanceUnit = useCallback(async (unit) => {
    // Optimistic update
    setDistanceUnitState(unit)
    localStorage.setItem(STORAGE_KEY, unit)

    // Sync to API if authenticated
    if (isAuthenticated) {
      try {
        const token = getAuthToken()
        await fetch('/api/users/preferences', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          credentials: 'include',
          body: JSON.stringify({ distanceUnit: unit })
        })
      } catch (err) {
        console.error('Error saving distance preference:', err)
      }
    }
  }, [isAuthenticated])

  // Memoized format function that includes the current unit
  const formatDistance = useCallback((km, options = {}) => {
    return formatDistanceUtil(km, distanceUnit, options)
  }, [distanceUnit])

  const value = useMemo(() => ({
    distanceUnit,
    setDistanceUnit,
    formatDistance,
    loading
  }), [distanceUnit, setDistanceUnit, formatDistance, loading])

  return (
    <DistanceContext.Provider value={value}>
      {children}
    </DistanceContext.Provider>
  )
}

/**
 * Main hook - returns full context including unit setter
 */
export function useDistance() {
  const context = useContext(DistanceContext)
  if (!context) {
    throw new Error('useDistance must be used within a DistanceProvider')
  }
  return context
}

/**
 * Convenience hook - returns just the formatDistance function
 * Use this in components that only need to display distances
 */
export function useFormatDistance() {
  const { formatDistance } = useDistance()
  return formatDistance
}

export default DistanceContext

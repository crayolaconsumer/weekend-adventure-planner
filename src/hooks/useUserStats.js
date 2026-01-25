/**
 * useUserStats Hook
 *
 * Track and sync user statistics.
 * - Anonymous users: localStorage
 * - Logged-in users: API (MySQL)
 */

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'

const STORAGE_KEY = 'roam_stats'

function getAuthToken() {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

function loadLocalStats() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

export function useUserStats() {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [stats, setStats] = useState(loadLocalStats)
  const [loading, setLoading] = useState(true)

  const loadStats = useCallback(async () => {
    setLoading(true)

    try {
      if (isAuthenticated) {
        const token = getAuthToken()
        const response = await fetch('/api/users/stats', {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        })

        if (response.ok) {
          const data = await response.json()
          setStats(data.stats)
        } else {
          setStats(loadLocalStats())
        }
      } else {
        setStats(loadLocalStats())
      }
    } catch (err) {
      console.error('Error loading stats:', err)
      setStats(loadLocalStats())
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (authLoading) return
    loadStats()
  }, [isAuthenticated, authLoading, loadStats])

  const incrementStat = useCallback(async (statName, amount = 1) => {
    // Optimistic local update
    setStats(prev => ({ ...prev, [statName]: (prev[statName] || 0) + amount }))

    // Update localStorage
    const local = loadLocalStats()
    local[statName] = (local[statName] || 0) + amount
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))

    // Sync to API if authenticated
    if (isAuthenticated) {
      try {
        const token = getAuthToken()
        await fetch('/api/users/stats', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          credentials: 'include',
          body: JSON.stringify({ increment: { [statName]: amount } })
        })
      } catch (err) {
        console.error('Error updating stat:', err)
      }
    }
  }, [isAuthenticated])

  const updateStats = useCallback(async (updates) => {
    // Optimistic local update
    setStats(prev => ({ ...prev, ...updates }))

    // Update localStorage
    const local = loadLocalStats()
    Object.assign(local, updates)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))

    // Sync to API if authenticated
    if (isAuthenticated) {
      try {
        const token = getAuthToken()
        await fetch('/api/users/stats', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          credentials: 'include',
          body: JSON.stringify(updates)
        })
      } catch (err) {
        console.error('Error updating stats:', err)
      }
    }
  }, [isAuthenticated])

  return {
    stats,
    loading: loading || authLoading,
    incrementStat,
    updateStats,
    refresh: loadStats
  }
}

export default useUserStats

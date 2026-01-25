/**
 * useUserPlans Hook
 *
 * Unified interface for user plans/adventures regardless of auth state.
 * - Anonymous users: localStorage
 * - Logged-in users: API (MySQL)
 */

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'

const STORAGE_KEY = 'roam_adventures'

function getAuthToken() {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

export function useUserPlans() {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadPlans = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      if (isAuthenticated) {
        const token = getAuthToken()
        const response = await fetch('/api/plans', {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        })

        if (!response.ok) {
          throw new Error('Failed to load plans')
        }

        const data = await response.json()
        setPlans(data.plans || [])
      } else {
        const saved = localStorage.getItem(STORAGE_KEY)
        setPlans(saved ? JSON.parse(saved) : [])
      }
    } catch (err) {
      console.error('Error loading plans:', err)
      // Fall back to localStorage
      const saved = localStorage.getItem(STORAGE_KEY)
      setPlans(saved ? JSON.parse(saved) : [])
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (authLoading) return
    loadPlans()
  }, [isAuthenticated, authLoading, loadPlans])

  const deletePlan = useCallback(async (planId) => {
    // Optimistic update
    setPlans(prev => prev.filter(p => p.id !== planId))

    if (isAuthenticated) {
      try {
        const token = getAuthToken()
        const response = await fetch(`/api/plans/${planId}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        })

        if (!response.ok) {
          throw new Error('Failed to delete plan')
        }
        return true
      } catch (err) {
        console.error('Error deleting plan:', err)
        // Fall back to localStorage
        const saved = localStorage.getItem(STORAGE_KEY)
        const current = saved ? JSON.parse(saved) : []
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current.filter(p => p.id !== planId)))
        return false
      }
    } else {
      const saved = localStorage.getItem(STORAGE_KEY)
      const current = saved ? JSON.parse(saved) : []
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current.filter(p => p.id !== planId)))
      return true
    }
  }, [isAuthenticated])

  return {
    plans,
    loading: loading || authLoading,
    error,
    refresh: loadPlans,
    deletePlan
  }
}

export default useUserPlans

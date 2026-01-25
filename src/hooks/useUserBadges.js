/**
 * useUserBadges Hook
 *
 * Manage user badges with API sync.
 * - Anonymous users: localStorage only
 * - Logged-in users: API (MySQL)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'

const STORAGE_KEY = 'roam_badges'

function getAuthToken() {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

function loadLocalBadges() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

export function useUserBadges() {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [badges, setBadges] = useState(loadLocalBadges)
  const [loading, setLoading] = useState(true)
  const syncedRef = useRef(false)

  // Load badges
  const loadBadges = useCallback(async () => {
    setLoading(true)

    try {
      if (isAuthenticated) {
        const token = getAuthToken()
        const response = await fetch('/api/users/badges', {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        })

        if (response.ok) {
          const data = await response.json()
          setBadges(data.badges || [])
          // Cache in localStorage
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data.badges || []))
        } else {
          setBadges(loadLocalBadges())
        }
      } else {
        setBadges(loadLocalBadges())
      }
    } catch (err) {
      console.error('Error loading badges:', err)
      setBadges(loadLocalBadges())
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  // Sync local badges to API on login
  useEffect(() => {
    if (authLoading || !isAuthenticated || syncedRef.current) return

    const syncLocalBadges = async () => {
      const token = getAuthToken()
      if (!token) return

      const local = loadLocalBadges()
      if (local.length === 0) return

      try {
        for (const badge of local) {
          if (badge.badgeId) {
            await fetch('/api/users/badges', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
              },
              credentials: 'include',
              body: JSON.stringify({ badgeId: badge.badgeId })
            }).catch(() => {})
          }
        }
        syncedRef.current = true
      } catch (err) {
        console.error('Error syncing badges:', err)
      }
    }

    syncLocalBadges()
  }, [isAuthenticated, authLoading])

  useEffect(() => {
    if (authLoading) return
    loadBadges()
  }, [isAuthenticated, authLoading, loadBadges])

  // Award a badge
  const awardBadge = useCallback(async (badgeId) => {
    // Check if already earned
    if (badges.some(b => b.badgeId === badgeId)) {
      return { success: true, alreadyEarned: true }
    }

    const badgeEntry = {
      badgeId,
      earnedAt: Date.now()
    }

    // Optimistic local update
    setBadges(prev => [...prev, badgeEntry])

    // Update localStorage
    const local = loadLocalBadges()
    if (!local.some(b => b.badgeId === badgeId)) {
      local.push(badgeEntry)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(local))
    }

    // Sync to API if authenticated
    if (isAuthenticated) {
      try {
        const token = getAuthToken()
        await fetch('/api/users/badges', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          credentials: 'include',
          body: JSON.stringify({ badgeId })
        })
      } catch (err) {
        console.error('Error awarding badge:', err)
      }
    }

    return { success: true }
  }, [isAuthenticated, badges])

  // Check if a badge is earned
  const hasBadge = useCallback((badgeId) => {
    return badges.some(b => b.badgeId === badgeId)
  }, [badges])

  return {
    badges,
    loading: loading || authLoading,
    awardBadge,
    hasBadge,
    refresh: loadBadges
  }
}

export default useUserBadges

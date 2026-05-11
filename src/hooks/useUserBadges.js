/**
 * useUserBadges Hook
 *
 * Manage user badges with API sync.
 * - Anonymous users: localStorage only
 * - Logged-in users: API (MySQL)
 */

import { useState, useEffect, useCallback } from 'react'
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

  // Note: there's no client → server badge sync on login. Server
  // badges are awarded server-side from real events (visit POST,
  // contribution POST, follow POST) — never from client-supplied
  // badge IDs (a self-award endpoint would let any user fake any
  // badge). The previous sync loop POSTed to /api/users/badges
  // which only handles GET → silent 405. Removed.

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

    // Server-side persistence happens through the proper paths
    // (visit POST → awardBadge('visits_10'), contribution POST →
    // awardBadge('contributor_10'), etc.). Client-only awards stay
    // in localStorage; they'll get reconciled on next GET if the
    // server also awarded the same ID.
    return { success: true }
  }, [badges])

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

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
const MIGRATION_PREFIX = 'roam_stats_migrated_'

// Server fields that previously lived only in localStorage. On first
// authenticated load after this update, if the server is missing a
// value but localStorage has one, push it up.
const MIGRATE_NUMERIC = ['timesWentOut', 'boredomBusts', 'currentStreak', 'bestStreak']
const MIGRATE_DATE = ['lastStreakDate', 'lastActivityAt']

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

/**
 * Apply streak-reset rules. If the last activity-streak date is more
 * than 1 day in the past, the streak is broken — render currentStreak
 * as 0 even though the server may still have the old number cached.
 * (We don't persist the reset; the next write that touches streak
 * will refresh the server value.)
 *
 * This used to live in UnifiedProfile/utils.ts#loadStatsFromStorage
 * and Discover.jsx, applied inconsistently. Centralising here means
 * every consumer of useUserStats gets the same numbers.
 */
/**
 * One-time backfill: if the user has localStorage stats from before
 * this update (e.g. streak counters that were trapped on their device)
 * and the server is missing them, push them up. Runs at most once per
 * user per device — gated by a per-user localStorage flag so a
 * subsequent app launch doesn't keep retrying.
 *
 * Returns the (possibly merged) stats object the caller should use.
 */
async function backfillFromLocalStorage(serverStats, token, userId) {
  if (!userId) return serverStats
  const flagKey = MIGRATION_PREFIX + userId
  try {
    if (localStorage.getItem(flagKey)) return serverStats
  } catch { /* localStorage unavailable — skip */ return serverStats }

  const local = loadLocalStats()
  const patch = {}

  for (const field of MIGRATE_NUMERIC) {
    const localVal = Number(local[field])
    const serverVal = Number(serverStats?.[field])
    if (Number.isFinite(localVal) && localVal > 0 && (!Number.isFinite(serverVal) || serverVal < localVal)) {
      patch[field] = localVal
    }
  }
  for (const field of MIGRATE_DATE) {
    const localVal = local[field]
    const serverVal = serverStats?.[field]
    if (localVal && !serverVal) {
      patch[field] = localVal
    }
  }

  // Mark migrated regardless of whether we sent anything, so we don't
  // re-check on every load.
  try { localStorage.setItem(flagKey, '1') } catch { /* noop */ }

  if (Object.keys(patch).length === 0) return serverStats

  try {
    await fetch('/api/users/stats', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      credentials: 'include',
      body: JSON.stringify(patch)
    })
    return { ...serverStats, ...patch }
  } catch (err) {
    console.warn('[stats] backfill failed (will retry next session):', err?.message || err)
    // Un-mark so we retry next time the user opens the app.
    try { localStorage.removeItem(flagKey) } catch { /* noop */ }
    return serverStats
  }
}

function applyStreakReset(rawStats) {
  if (!rawStats) return rawStats
  const lastStreakDate = rawStats.lastStreakDate
  if (!lastStreakDate) return rawStats

  const lastDate = new Date(lastStreakDate)
  if (Number.isNaN(lastDate.getTime())) return rawStats

  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const lastDateStr = lastDate.toDateString()
  const todayStr = today.toDateString()
  const yesterdayStr = yesterday.toDateString()

  if (lastDateStr === todayStr || lastDateStr === yesterdayStr) {
    return rawStats
  }
  // Streak broken. Best stays. Current resets.
  return { ...rawStats, currentStreak: 0 }
}

export function useUserStats() {
  const { isAuthenticated, user, loading: authLoading } = useAuth()
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
          const merged = await backfillFromLocalStorage(data.stats, token, user?.id)
          setStats(applyStreakReset(merged))
        } else {
          setStats(applyStreakReset(loadLocalStats()))
        }
      } else {
        setStats(applyStreakReset(loadLocalStats()))
      }
    } catch (err) {
      console.error('Error loading stats:', err)
      setStats(applyStreakReset(loadLocalStats()))
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated, user?.id])

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

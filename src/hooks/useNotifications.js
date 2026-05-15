/**
 * useNotifications Hook
 *
 * Manages in-app notifications with polling
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'

/**
 * Get auth headers for API requests
 */
function getAuthHeaders() {
  const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Hook for fetching and managing notifications
 */
export function useNotifications({ pollInterval = 60000 } = {}) {
  const { isAuthenticated } = useAuth()
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const pollingRef = useRef(null)

  const fetchNotifications = useCallback(async (offset = 0, unreadOnly = false) => {
    if (!isAuthenticated) return

    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        limit: '20',
        offset: String(offset),
        unread_only: String(unreadOnly)
      })

      const response = await fetch(`/api/notifications?${params}`, {
        credentials: 'include',
        headers: getAuthHeaders()
      })

      if (!response.ok) {
        throw new Error('Failed to load notifications')
      }

      const data = await response.json()

      if (offset === 0) {
        setNotifications(data.notifications)
      } else {
        setNotifications(prev => [...prev, ...data.notifications])
      }
      setUnreadCount(data.unreadCount)
      setHasMore(data.hasMore)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchNotifications(notifications.length)
    }
  }, [loading, hasMore, notifications.length, fetchNotifications])

  const markAsRead = useCallback(async (notificationIds) => {
    if (!isAuthenticated || !notificationIds.length) return

    try {
      const response = await fetch('/api/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        credentials: 'include',
        body: JSON.stringify({
          action: 'mark_read',
          notificationIds
        })
      })

      if (response.ok) {
        // Update local state
        setNotifications(prev =>
          prev.map(n =>
            notificationIds.includes(n.id) ? { ...n, isRead: true } : n
          )
        )
        setUnreadCount(prev => Math.max(0, prev - notificationIds.length))
      }
    } catch (err) {
      console.error('Failed to mark notifications as read:', err)
    }
  }, [isAuthenticated])

  const markAllAsRead = useCallback(async () => {
    if (!isAuthenticated) return

    try {
      const response = await fetch('/api/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        credentials: 'include',
        body: JSON.stringify({ action: 'mark_all_read' })
      })

      if (response.ok) {
        setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
        setUnreadCount(0)
      }
    } catch (err) {
      console.error('Failed to mark all as read:', err)
    }
  }, [isAuthenticated])

  // Initial fetch
  useEffect(() => {
    if (isAuthenticated) {
      fetchNotifications(0)
    } else {
      setNotifications([])
      setUnreadCount(0)
    }
  }, [isAuthenticated, fetchNotifications])

  // Listen for badge updates from service worker (replaces polling)
  //
  // When a push arrives the SW posts NOTIFICATION_COUNT with the new
  // unread total. If we just bump unreadCount the dropdown shows "(1)"
  // but its list is still the stale one from initial mount — the user
  // sees a badge with nothing behind it until they close + reopen the
  // app. Refresh the full list whenever the count changes so the badge
  // and the dropdown stay in lockstep.
  useEffect(() => {
    if (!isAuthenticated) return

    const handleMessage = (event) => {
      if (event.data?.type === 'NOTIFICATION_COUNT') {
        fetchNotifications(0)
      }
    }

    navigator.serviceWorker?.addEventListener('message', handleMessage)

    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleMessage)
    }
  }, [isAuthenticated, fetchNotifications])

  // Re-fetch when the app comes back to the foreground. On native
  // iOS/Android the WebView suspends setInterval while backgrounded,
  // so the fallback polling below can be up to pollInterval seconds
  // late catching up after resume. nativeAppLifecycle.js dispatches
  // 'roam-app-foreground' as soon as Capacitor reports isActive=true
  // — listen for it and refresh immediately so a push that arrived
  // (or an in-app notification created server-side) shows in the bell
  // the moment the user reopens the app, not on next close+reopen.
  useEffect(() => {
    if (!isAuthenticated) return

    const handleForeground = () => fetchNotifications(0)
    window.addEventListener('roam-app-foreground', handleForeground)
    // Web fallback — visibilitychange fires on PWA + desktop browsers
    // when the tab becomes visible again.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchNotifications(0)
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.removeEventListener('roam-app-foreground', handleForeground)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [isAuthenticated, fetchNotifications])

  // Fallback polling only if service worker is not available.
  // Like the SW handler above: when polling detects a count change,
  // refresh the whole list — not just the count — so the dropdown
  // doesn't show a phantom badge.
  useEffect(() => {
    if (!isAuthenticated || !pollInterval) return

    pollingRef.current = setInterval(() => {
      // SW now active → stop polling; SW handler takes over.
      if (navigator.serviceWorker?.controller) {
        if (pollingRef.current) {
          clearInterval(pollingRef.current)
          pollingRef.current = null
        }
        return
      }

      fetch('/api/notifications?limit=1&unread_only=true', {
        credentials: 'include',
        headers: getAuthHeaders()
      })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data == null) return
          // Functional update so we can compare against the current
          // count without a stale closure on unreadCount.
          setUnreadCount(prev => {
            if (data.unreadCount !== prev) {
              fetchNotifications(0)
            }
            return data.unreadCount
          })
        })
        .catch(() => {}) // Silently fail polling
    }, pollInterval)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [isAuthenticated, pollInterval, fetchNotifications])

  return {
    notifications,
    unreadCount,
    loading,
    error,
    hasMore,
    loadMore,
    markAsRead,
    markAllAsRead,
    refresh: () => fetchNotifications(0)
  }
}

export default useNotifications

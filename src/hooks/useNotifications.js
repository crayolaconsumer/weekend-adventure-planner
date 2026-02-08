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
  useEffect(() => {
    if (!isAuthenticated) return

    const handleMessage = (event) => {
      if (event.data?.type === 'NOTIFICATION_COUNT') {
        setUnreadCount(event.data.count)
      }
    }

    // Add listener for service worker messages
    navigator.serviceWorker?.addEventListener('message', handleMessage)

    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleMessage)
    }
  }, [isAuthenticated])

  // Fallback polling only if service worker is not available (reduced frequency)
  useEffect(() => {
    if (!isAuthenticated || !pollInterval) return
    // Skip polling if service worker is active (push will handle updates)
    if (navigator.serviceWorker?.controller) return

    pollingRef.current = setInterval(() => {
      // Just refresh unread count
      fetch('/api/notifications?limit=1&unread_only=true', {
        credentials: 'include',
        headers: getAuthHeaders()
      })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) {
            setUnreadCount(data.unreadCount)
          }
        })
        .catch(() => {}) // Silently fail polling
    }, pollInterval)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  }, [isAuthenticated, pollInterval])

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

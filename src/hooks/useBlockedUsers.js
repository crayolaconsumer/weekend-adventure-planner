/**
 * useBlockedUsers Hook
 *
 * Manage blocked users list
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

export function useBlockedUsers() {
  const { isAuthenticated } = useAuth()
  const [blockedUsers, setBlockedUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [processing, setProcessing] = useState(null) // ID of user being processed
  const hasFetched = useRef(false)

  const fetchBlockedUsers = useCallback(async (offset = 0) => {
    if (!isAuthenticated) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/social/block?limit=50&offset=${offset}`,
        {
          credentials: 'include',
          headers: getAuthHeaders()
        }
      )

      if (!response.ok) {
        throw new Error('Failed to load blocked users')
      }

      const data = await response.json()

      if (offset === 0) {
        setBlockedUsers(data.blockedUsers)
      } else {
        setBlockedUsers(prev => [...prev, ...data.blockedUsers])
      }
      setTotal(data.total)
      setHasMore(data.hasMore)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  const blockUser = useCallback(async (userId) => {
    if (!isAuthenticated) {
      return { success: false, error: 'Authentication required' }
    }

    setProcessing(userId)
    setError(null)

    try {
      const response = await fetch('/api/social/block', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        credentials: 'include',
        body: JSON.stringify({ userId, action: 'block' })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to block user')
      }

      // Refresh the list to show the newly blocked user
      await fetchBlockedUsers(0)

      return { success: true }
    } catch (err) {
      setError(err.message)
      return { success: false, error: err.message }
    } finally {
      setProcessing(null)
    }
  }, [isAuthenticated, fetchBlockedUsers])

  const unblockUser = useCallback(async (userId) => {
    if (!isAuthenticated) {
      return { success: false, error: 'Authentication required' }
    }

    setProcessing(userId)
    setError(null)

    try {
      const response = await fetch('/api/social/block', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        credentials: 'include',
        body: JSON.stringify({ userId, action: 'unblock' })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to unblock user')
      }

      // Remove from list
      setBlockedUsers(prev => prev.filter(b => b.user.id !== userId))
      setTotal(prev => Math.max(0, prev - 1))

      return { success: true }
    } catch (err) {
      setError(err.message)
      return { success: false, error: err.message }
    } finally {
      setProcessing(null)
    }
  }, [isAuthenticated])

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchBlockedUsers(blockedUsers.length)
    }
  }, [loading, hasMore, blockedUsers.length, fetchBlockedUsers])

  useEffect(() => {
    if (!isAuthenticated || hasFetched.current) return
    hasFetched.current = true
    fetchBlockedUsers(0)
  }, [isAuthenticated, fetchBlockedUsers])

  return {
    blockedUsers,
    loading,
    error,
    total,
    hasMore,
    processing,
    blockUser,
    unblockUser,
    loadMore,
    refresh: () => fetchBlockedUsers(0)
  }
}

export default useBlockedUsers

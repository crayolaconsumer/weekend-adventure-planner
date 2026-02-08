/**
 * useFollowRequests Hook
 *
 * Manage follow requests for private accounts
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

export function useFollowRequests() {
  const { isAuthenticated } = useAuth()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [processing, setProcessing] = useState(null) // ID of request being processed
  const hasFetched = useRef(false)

  const fetchRequests = useCallback(async (offset = 0, status = 'pending') => {
    if (!isAuthenticated) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/social/requests?status=${status}&limit=20&offset=${offset}`,
        {
          credentials: 'include',
          headers: getAuthHeaders()
        }
      )

      if (!response.ok) {
        throw new Error('Failed to load follow requests')
      }

      const data = await response.json()

      if (offset === 0) {
        setRequests(data.requests)
      } else {
        setRequests(prev => [...prev, ...data.requests])
      }
      setTotal(data.total)
      setHasMore(data.hasMore)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  const approveRequest = useCallback(async (requestId) => {
    if (!isAuthenticated) {
      return { success: false, error: 'Authentication required' }
    }

    setProcessing(requestId)
    setError(null)

    try {
      const response = await fetch('/api/social/requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        credentials: 'include',
        body: JSON.stringify({ requestId, action: 'approve' })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to approve request')
      }

      // Remove from list
      setRequests(prev => prev.filter(r => r.id !== requestId))
      setTotal(prev => Math.max(0, prev - 1))

      return { success: true }
    } catch (err) {
      setError(err.message)
      return { success: false, error: err.message }
    } finally {
      setProcessing(null)
    }
  }, [isAuthenticated])

  const rejectRequest = useCallback(async (requestId) => {
    if (!isAuthenticated) {
      return { success: false, error: 'Authentication required' }
    }

    setProcessing(requestId)
    setError(null)

    try {
      const response = await fetch('/api/social/requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        credentials: 'include',
        body: JSON.stringify({ requestId, action: 'reject' })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reject request')
      }

      // Remove from list
      setRequests(prev => prev.filter(r => r.id !== requestId))
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
      fetchRequests(requests.length)
    }
  }, [loading, hasMore, requests.length, fetchRequests])

  useEffect(() => {
    if (!isAuthenticated || hasFetched.current) return
    hasFetched.current = true
    fetchRequests(0)
  }, [isAuthenticated, fetchRequests])

  return {
    requests,
    loading,
    error,
    total,
    hasMore,
    processing,
    approveRequest,
    rejectRequest,
    loadMore,
    refresh: () => fetchRequests(0)
  }
}

export default useFollowRequests

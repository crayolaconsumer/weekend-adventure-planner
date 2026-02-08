/**
 * useContributions Hook
 *
 * Fetch and manage contributions for places.
 */

import { useState, useCallback, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'

/**
 * Get auth headers for API requests
 */
function getAuthHeaders() {
  const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Hook for fetching contributions for a place
 */
export function useContributions(placeId) {
  const [contributions, setContributions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchContributions = useCallback(async () => {
    if (!placeId) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/contributions?placeId=${encodeURIComponent(placeId)}`, {
        credentials: 'include',
        headers: getAuthHeaders()
      })

      if (!response.ok) {
        throw new Error('Failed to fetch contributions')
      }

      const data = await response.json()
      setContributions(data.contributions || [])
    } catch {
      // Silently fail - API might not be configured in development
      setError('Contributions unavailable')
    } finally {
      setLoading(false)
    }
  }, [placeId])

  // Auto-fetch when placeId changes
  useEffect(() => {
    fetchContributions()
  }, [fetchContributions])

  return {
    contributions,
    loading,
    error,
    refresh: fetchContributions
  }
}

/**
 * Hook for fetching user's contributions
 */
export function useUserContributions(userId) {
  const [contributions, setContributions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchContributions = useCallback(async () => {
    if (!userId) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/contributions?userId=${userId}`, {
        credentials: 'include',
        headers: getAuthHeaders()
      })

      if (!response.ok) {
        throw new Error('Failed to fetch contributions')
      }

      const data = await response.json()
      setContributions(data.contributions || [])
    } catch {
      // Silently fail - API might not be configured in development
      setError('Contributions unavailable')
    } finally {
      setLoading(false)
    }
  }, [userId])

  // Auto-fetch when userId changes
  useEffect(() => {
    fetchContributions()
  }, [fetchContributions])

  return {
    contributions,
    loading,
    error,
    refresh: fetchContributions
  }
}

/**
 * Hook for creating contributions
 */
export function useCreateContribution() {
  const { isAuthenticated } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const createContribution = useCallback(async ({ placeId, type, content, metadata, visibility, placeName, placeCategory, placeImageUrl }) => {
    if (!isAuthenticated) {
      return { success: false, error: 'Authentication required' }
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/contributions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        credentials: 'include',
        body: JSON.stringify({
          placeId,
          type,
          content,
          metadata,
          visibility,
          placeName,
          placeCategory,
          placeImageUrl
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create contribution')
      }

      setLoading(false)
      return { success: true, contribution: data.contribution }
    } catch (err) {
      setLoading(false)
      setError(err.message)
      return { success: false, error: err.message }
    }
  }, [isAuthenticated])

  return {
    createContribution,
    loading,
    error
  }
}

/**
 * Hook for voting on contributions
 */
export function useVote() {
  const { isAuthenticated } = useAuth()
  const [loading, setLoading] = useState(false)

  const vote = useCallback(async (contributionId, voteType) => {
    if (!isAuthenticated) {
      return { success: false, error: 'Authentication required' }
    }

    setLoading(true)

    try {
      const response = await fetch('/api/contributions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        credentials: 'include',
        body: JSON.stringify({ action: 'vote', contributionId, voteType })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to vote')
      }

      setLoading(false)
      return { success: true, ...data }
    } catch (err) {
      setLoading(false)
      return { success: false, error: err.message }
    }
  }, [isAuthenticated])

  return { vote, loading }
}

export default {
  useContributions,
  useUserContributions,
  useCreateContribution,
  useVote
}

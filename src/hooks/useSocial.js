/**
 * useSocial Hooks
 *
 * Hooks for social features: following, activity feed, user discovery
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
 * Hook for following/unfollowing users
 */
export function useFollow() {
  const { isAuthenticated } = useAuth()
  const [loading, setLoading] = useState(false)

  const follow = useCallback(async (userId) => {
    if (!isAuthenticated) {
      return { success: false, error: 'Authentication required' }
    }

    setLoading(true)
    try {
      const response = await fetch('/api/social', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        credentials: 'include',
        body: JSON.stringify({ action: 'follow', userId })
      })

      const data = await response.json()
      setLoading(false)

      if (!response.ok) {
        return { success: false, error: data.error }
      }

      // status can be 'following' or 'requested' (for private accounts)
      return {
        success: true,
        followerCount: data.followerCount,
        status: data.status || 'following'
      }
    } catch (err) {
      setLoading(false)
      return { success: false, error: err.message }
    }
  }, [isAuthenticated])

  const unfollow = useCallback(async (userId) => {
    if (!isAuthenticated) {
      return { success: false, error: 'Authentication required' }
    }

    setLoading(true)
    try {
      const response = await fetch('/api/social', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        credentials: 'include',
        body: JSON.stringify({ action: 'unfollow', userId })
      })

      const data = await response.json()
      setLoading(false)

      if (!response.ok) {
        return { success: false, error: data.error }
      }

      return {
        success: true,
        followerCount: data.followerCount,
        status: data.status || 'not_following'
      }
    } catch (err) {
      setLoading(false)
      return { success: false, error: err.message }
    }
  }, [isAuthenticated])

  return { follow, unfollow, loading }
}

/**
 * Hook for fetching user profile
 */
export function useUserProfile(username) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchProfile = useCallback(async () => {
    if (!username) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/users/${encodeURIComponent(username)}`, {
        credentials: 'include',
        headers: getAuthHeaders()
      })

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('User not found')
        }
        throw new Error('Failed to load profile')
      }

      const data = await response.json()
      setProfile(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [username])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  return { profile, loading, error, refresh: fetchProfile }
}

/**
 * Hook for fetching followers
 */
export function useFollowers(userId) {
  const [followers, setFollowers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)

  const fetchFollowers = useCallback(async (offset = 0) => {
    if (!userId) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/social?action=followers&userId=${userId}&limit=20&offset=${offset}`,
        {
          credentials: 'include',
          headers: getAuthHeaders()
        }
      )

      if (!response.ok) {
        throw new Error('Failed to load followers')
      }

      const data = await response.json()

      if (offset === 0) {
        setFollowers(data.followers)
      } else {
        setFollowers(prev => [...prev, ...data.followers])
      }
      setTotal(data.total)
      setHasMore(data.hasMore)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [userId])

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchFollowers(followers.length)
    }
  }, [loading, hasMore, followers.length, fetchFollowers])

  useEffect(() => {
    fetchFollowers(0)
  }, [fetchFollowers])

  return { followers, loading, error, total, hasMore, loadMore, refresh: () => fetchFollowers(0) }
}

/**
 * Hook for fetching following
 */
export function useFollowing(userId) {
  const [following, setFollowing] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)

  const fetchFollowing = useCallback(async (offset = 0) => {
    if (!userId) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/social?action=following&userId=${userId}&limit=20&offset=${offset}`,
        {
          credentials: 'include',
          headers: getAuthHeaders()
        }
      )

      if (!response.ok) {
        throw new Error('Failed to load following')
      }

      const data = await response.json()

      if (offset === 0) {
        setFollowing(data.following)
      } else {
        setFollowing(prev => [...prev, ...data.following])
      }
      setTotal(data.total)
      setHasMore(data.hasMore)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [userId])

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchFollowing(following.length)
    }
  }, [loading, hasMore, following.length, fetchFollowing])

  useEffect(() => {
    fetchFollowing(0)
  }, [fetchFollowing])

  return { following, loading, error, total, hasMore, loadMore, refresh: () => fetchFollowing(0) }
}

/**
 * Hook for activity feed
 */
export function useActivityFeed() {
  const { isAuthenticated } = useAuth()
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [hasMore, setHasMore] = useState(false)

  const fetchActivities = useCallback(async (offset = 0) => {
    if (!isAuthenticated) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/social?action=feed&limit=20&offset=${offset}`,
        {
          credentials: 'include',
          headers: getAuthHeaders()
        }
      )

      if (!response.ok) {
        throw new Error('Failed to load activity feed')
      }

      const data = await response.json()

      if (offset === 0) {
        setActivities(data.activities)
      } else {
        setActivities(prev => [...prev, ...data.activities])
      }
      setHasMore(data.hasMore)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchActivities(activities.length)
    }
  }, [loading, hasMore, activities.length, fetchActivities])

  useEffect(() => {
    fetchActivities(0)
  }, [fetchActivities])

  return { activities, loading, error, hasMore, loadMore, refresh: () => fetchActivities(0) }
}

/**
 * Hook for discovering users ("People Like You")
 */
export function useDiscoverUsers() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/social?action=discover&limit=10', {
        credentials: 'include',
        headers: getAuthHeaders()
      })

      if (!response.ok) {
        throw new Error('Failed to load recommendations')
      }

      const data = await response.json()
      setUsers(data.users)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  return { users, loading, error, refresh: fetchUsers }
}

/**
 * Hook for searching users
 */
export function useUserSearch() {
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)

  const search = useCallback(async (query, offset = 0) => {
    if (!query || query.trim().length < 2) {
      setResults([])
      setTotal(0)
      setHasMore(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/users/search?q=${encodeURIComponent(query.trim())}&limit=20&offset=${offset}`,
        {
          credentials: 'include',
          headers: getAuthHeaders()
        }
      )

      if (!response.ok) {
        throw new Error('Search failed')
      }

      const data = await response.json()

      if (offset === 0) {
        setResults(data.users)
      } else {
        setResults(prev => [...prev, ...data.users])
      }
      setTotal(data.total)
      setHasMore(data.hasMore)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMore = useCallback((query) => {
    if (!loading && hasMore) {
      search(query, results.length)
    }
  }, [loading, hasMore, results.length, search])

  const clearResults = useCallback(() => {
    setResults([])
    setTotal(0)
    setHasMore(false)
    setError(null)
  }, [])

  return { results, loading, error, total, hasMore, search, loadMore, clearResults }
}

export default {
  useFollow,
  useUserProfile,
  useFollowers,
  useFollowing,
  useActivityFeed,
  useDiscoverUsers,
  useUserSearch
}

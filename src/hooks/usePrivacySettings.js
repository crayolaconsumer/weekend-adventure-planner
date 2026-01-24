/**
 * usePrivacySettings Hook
 *
 * Fetch and update user privacy settings
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

export function usePrivacySettings() {
  const { isAuthenticated } = useAuth()
  const [settings, setSettings] = useState(null)
  const [pendingRequestCount, setPendingRequestCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const fetchSettings = useCallback(async () => {
    if (!isAuthenticated) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/users/privacy', {
        credentials: 'include',
        headers: getAuthHeaders()
      })

      if (!response.ok) {
        throw new Error('Failed to load privacy settings')
      }

      const data = await response.json()
      setSettings(data.settings)
      setPendingRequestCount(data.pendingRequestCount || 0)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  const updateSettings = useCallback(async (updates) => {
    if (!isAuthenticated) {
      return { success: false, error: 'Authentication required' }
    }

    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/users/privacy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        credentials: 'include',
        body: JSON.stringify(updates)
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update settings')
      }

      setSettings(data.settings)

      // If auto-approved requests when going public
      if (data.autoApprovedRequests > 0) {
        setPendingRequestCount(0)
      }

      return { success: true, autoApprovedRequests: data.autoApprovedRequests }
    } catch (err) {
      setError(err.message)
      return { success: false, error: err.message }
    } finally {
      setSaving(false)
    }
  }, [isAuthenticated])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  return {
    settings,
    pendingRequestCount,
    loading,
    error,
    saving,
    updateSettings,
    refresh: fetchSettings
  }
}

export default usePrivacySettings

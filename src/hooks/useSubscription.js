import { useState, useCallback, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'

/**
 * Hook for managing user subscription state and premium features
 *
 * @returns {Object} Subscription state and methods
 */
export function useSubscription() {
  const { user, checkAuth } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Get stored auth token (same logic as AuthContext)
  const getStoredToken = () => {
    return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
  }

  // Determine if user has premium access
  const isPremium = useMemo(() => {
    if (!user) return false
    if (user.tier === 'premium') {
      // Check if subscription hasn't expired
      if (user.subscription_expires_at) {
        return new Date(user.subscription_expires_at) > new Date()
      }
      return true
    }
    return false
  }, [user])

  // Feature access checks
  const features = useMemo(() => ({
    unlimitedSaves: isPremium,
    unlimitedCollections: isPremium,
    offlineMaps: isPremium,
    adFree: isPremium,
    advancedFilters: isPremium,
    exportAdventures: isPremium,
    earlyAccess: isPremium,
    extendedRadius: isPremium, // Day Trip (75km) and Explorer (150km) modes
    // Limits for free users
    saveLimit: isPremium ? Infinity : 10,
    collectionLimit: isPremium ? Infinity : 3
  }), [isPremium])

  // Check if a specific feature is available
  const hasFeature = useCallback((featureName) => {
    return features[featureName] === true || features[featureName] === Infinity
  }, [features])

  // Check if user has reached a limit
  const hasReachedLimit = useCallback((limitName, currentCount) => {
    const limit = features[limitName]
    if (limit === Infinity) return false
    return currentCount >= limit
  }, [features])

  // Start checkout flow
  const startCheckout = useCallback(async (plan = 'premium_monthly') => {
    if (!user) {
      setError('Please sign in to upgrade')
      return null
    }

    setLoading(true)
    setError(null)

    try {
      const token = getStoredToken()
      const response = await fetch('/api/payments/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        credentials: 'include',
        body: JSON.stringify({ plan })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to start checkout')
      }

      const { url } = await response.json()

      // Redirect to Stripe Checkout
      if (url) {
        window.location.href = url
      }

      return url
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [user])

  // Manage subscription (cancel, update payment method)
  const manageSubscription = useCallback(async () => {
    if (!user) {
      setError('Please sign in first')
      return null
    }

    setLoading(true)
    setError(null)

    try {
      const token = getStoredToken()
      const response = await fetch('/api/payments/create-portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        credentials: 'include'
      })

      if (!response.ok) {
        const data = await response.json()

        // Handle specific error codes with user-friendly messages
        if (data.code === 'NO_SUBSCRIPTION') {
          setError('No active subscription found. Subscribe to ROAM+ to manage billing.')
          return null
        }
        if (data.code === 'NO_SUBSCRIPTION_HISTORY') {
          setError('No subscription history found. Subscribe to ROAM+ first.')
          return null
        }
        if (data.code === 'CUSTOMER_NOT_FOUND') {
          setError('Billing account not found. Please contact support at hello@go-roam.com')
          return null
        }

        throw new Error(data.message || data.error || 'Failed to open billing portal')
      }

      const { url } = await response.json()

      // Redirect to Stripe Customer Portal
      if (url) {
        window.location.href = url
      }

      return url
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [user])

  // Refresh subscription status
  const refreshSubscription = useCallback(async () => {
    await checkAuth?.()
  }, [checkAuth])

  return {
    // State
    isPremium,
    tier: user?.tier || 'free',
    expiresAt: user?.subscription_expires_at,
    isCancelled: !!user?.subscription_cancelled_at,
    loading,
    error,

    // Feature access
    features,
    hasFeature,
    hasReachedLimit,

    // Actions
    startCheckout,
    manageSubscription,
    refreshSubscription
  }
}

export default useSubscription

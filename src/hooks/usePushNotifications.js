/**
 * usePushNotifications Hook
 *
 * Manages push notification subscriptions for the PWA
 */

import { useState, useEffect, useCallback } from 'react'

// Get auth token from storage
function getAuthToken() {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

function getAuthHeaders() {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function usePushNotifications() {
  const [permission, setPermission] = useState('default')
  const [subscription, setSubscription] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [supported, setSupported] = useState(false)

  // Check support and current state on mount
  useEffect(() => {
    const checkSupport = async () => {
      // Check if push is supported
      const pushSupported = 'serviceWorker' in navigator &&
                           'PushManager' in window &&
                           'Notification' in window

      setSupported(pushSupported)

      if (!pushSupported) return

      // Get current permission
      setPermission(Notification.permission)

      // Check for existing subscription
      try {
        const registration = await navigator.serviceWorker.ready
        const existingSub = await registration.pushManager.getSubscription()
        setSubscription(existingSub)
      } catch {
        // Ignore errors
      }
    }

    checkSupport()
  }, [])

  // Subscribe to push notifications
  const subscribe = useCallback(async () => {
    if (!supported) {
      setError('Push notifications are not supported')
      return null
    }

    setLoading(true)
    setError(null)

    try {
      // Request permission if needed
      if (Notification.permission === 'default') {
        const result = await Notification.requestPermission()
        setPermission(result)
        if (result !== 'granted') {
          setError('Permission denied')
          setLoading(false)
          return null
        }
      } else if (Notification.permission === 'denied') {
        setError('Notifications are blocked. Please enable them in your browser settings.')
        setLoading(false)
        return null
      }

      // Get VAPID public key from server
      const vapidResponse = await fetch('/api/push/vapid-public-key')
      if (!vapidResponse.ok) {
        throw new Error('Failed to get VAPID key')
      }
      const { publicKey } = await vapidResponse.json()

      // Convert VAPID key to Uint8Array
      const applicationServerKey = urlBase64ToUint8Array(publicKey)

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready

      // Subscribe to push
      const newSubscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      })

      // Send subscription to server
      const saveResponse = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        credentials: 'include',
        body: JSON.stringify(newSubscription.toJSON())
      })

      if (!saveResponse.ok) {
        throw new Error('Failed to save subscription')
      }

      setSubscription(newSubscription)
      return newSubscription
    } catch (err) {
      console.error('Push subscription error:', err)
      setError(err.message || 'Failed to subscribe')
      return null
    } finally {
      setLoading(false)
    }
  }, [supported])

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async () => {
    if (!subscription) return

    setLoading(true)
    setError(null)

    try {
      await subscription.unsubscribe()

      // Notify server
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        credentials: 'include',
        body: JSON.stringify({ endpoint: subscription.endpoint })
      })

      setSubscription(null)
    } catch (err) {
      console.error('Unsubscribe error:', err)
      setError(err.message || 'Failed to unsubscribe')
    } finally {
      setLoading(false)
    }
  }, [subscription])

  return {
    supported,
    permission,
    subscription,
    isSubscribed: !!subscription,
    loading,
    error,
    subscribe,
    unsubscribe
  }
}

// Helper function to convert VAPID key
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/')

  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export default usePushNotifications

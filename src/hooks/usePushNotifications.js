/**
 * usePushNotifications Hook
 *
 * Manages push notification subscriptions for both PWA (VAPID web push)
 * and native iOS/Android (Capacitor + APNS/FCM).
 *
 * Native vs web is auto-detected via nativeBridge.isNative(). On native,
 * we use @capacitor/push-notifications which returns an APNS device token
 * (iOS) or FCM token (Android) — both stored server-side as platform-
 * tagged subscriptions in push_subscriptions, then dispatched per
 * platform by api/lib/pushNotifications.js.
 */

import { useState, useEffect, useCallback } from 'react'
import { isNative, getPlatform } from '../utils/nativeBridge'

export const PUSH_OPT_IN_KEY = 'roam_push_opted_in'

// Get auth token from storage
function getAuthToken() {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

function getAuthHeaders() {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function bestEffortUnsubscribePushNotifications(subscription = null) {
  const authHeaders = getAuthHeaders()

  try {
    let endpoint = subscription?.endpoint || null
    let platform = 'web'

    if (isNative()) {
      platform = getPlatform() === 'ios' ? 'ios' : 'android'
    } else if (!endpoint && 'serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready
      const existingSub = await registration.pushManager.getSubscription()
      endpoint = existingSub?.endpoint || null
      if (existingSub && typeof existingSub.unsubscribe === 'function') {
        await existingSub.unsubscribe()
      }
    } else if (subscription && typeof subscription.unsubscribe === 'function') {
      await subscription.unsubscribe()
    }

    if (!endpoint && platform === 'web') return

    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders
      },
      credentials: 'include',
      body: JSON.stringify(endpoint ? { endpoint } : { platform })
    })
  } catch (err) {
    console.error('Unsubscribe error:', err)
  } finally {
    try {
      localStorage.removeItem(PUSH_OPT_IN_KEY)
    } catch {
      // localStorage unavailable.
    }
  }
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
      if (isNative()) {
        // Native always supports push (subject to user permission)
        setSupported(true)
        try {
          const { PushNotifications } = await import('@capacitor/push-notifications')
          const status = await PushNotifications.checkPermissions()
          const granted = status.receive === 'granted'
          setPermission(granted ? 'granted' :
                       status.receive === 'denied' ? 'denied' : 'default')

          // Restore subscription state from server. Previously this
          // branch only set permission; the subscription state stayed
          // null on every app launch, so the Settings toggle always
          // showed OFF after a cold start even when a valid token was
          // stored and pushes would actually deliver. GET /api/push/
          // subscribe returns whether a row exists for this user on
          // the current platform — set state accordingly so the toggle
          // reflects reality.
          if (granted) {
            try {
              const platform = getPlatform() === 'ios' ? 'ios' : 'android'
              const res = await fetch(`/api/push/subscribe?platform=${platform}`, {
                credentials: 'include',
                headers: getAuthHeaders()
              })
              if (res.ok) {
                const data = await res.json()
                if (data?.subscribed) {
                  // Sentinel — the actual token is server-side. The
                  // hook only consumes !!subscription, so a truthy
                  // value here is enough to flip isSubscribed on.
                  setSubscription({ platform, restored: true })
                }
              }
            } catch {
              // Network error — leave subscription null. Worst case
              // user sees toggle as OFF and re-toggles, which upserts
              // their token. No real harm.
            }
          }
        } catch {
          setSupported(false)
        }
        return
      }

      // Web — check VAPID prerequisites
      const pushSupported = 'serviceWorker' in navigator &&
                           'PushManager' in window &&
                           'Notification' in window

      setSupported(pushSupported)
      if (!pushSupported) return

      setPermission(Notification.permission)

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
      if (isNative()) {
        // Native flow — Capacitor PushNotifications plugin
        const { PushNotifications } = await import('@capacitor/push-notifications')

        // Request permission if needed
        const permStatus = await PushNotifications.requestPermissions()
        if (permStatus.receive !== 'granted') {
          setPermission('denied')
          setError('Permission denied')
          setLoading(false)
          return null
        }
        setPermission('granted')

        // Token comes back via the 'registration' event listener — APNS
        // registration is async after register() resolves. Set listeners
        // BEFORE register() to avoid races.
        let regHandle, errHandle
        const cleanup = () => { regHandle?.remove(); errHandle?.remove() }
        const tokenPromise = new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            cleanup()
            reject(new Error('Push registration timed out'))
          }, 10000)
          PushNotifications.addListener('registration', (token) => {
            clearTimeout(timer); cleanup(); resolve(token.value)
          }).then(h => { regHandle = h })
          PushNotifications.addListener('registrationError', (err) => {
            clearTimeout(timer); cleanup()
            reject(new Error(err?.error || 'Registration failed'))
          }).then(h => { errHandle = h })
        })

        await PushNotifications.register()
        const deviceToken = await tokenPromise

        const platform = getPlatform() === 'ios' ? 'ios' : 'android'
        const saveResponse = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders()
          },
          body: JSON.stringify({ platform, token: deviceToken })
        })
        if (!saveResponse.ok) throw new Error('Failed to save native subscription')

        setSubscription({ platform, endpoint: deviceToken })
        return { platform, endpoint: deviceToken }
      }

      // Web flow — VAPID
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
      await bestEffortUnsubscribePushNotifications(subscription)
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

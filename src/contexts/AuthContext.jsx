/**
 * Auth Context
 *
 * Provides authentication state and methods throughout the app.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { identifyUser, clearUser } from '../utils/errorReporting'
import { identify as analyticsIdentify, resetAnalytics, track } from '../utils/analytics'
import { identifyUserToRC, logoutFromRC } from '../utils/revenueCat'
import { bestEffortUnsubscribePushNotifications } from '../hooks/usePushNotifications'

const TOKEN_STORAGE_KEY = 'roam_auth_token'
const SESSION_TOKEN_STORAGE_KEY = 'roam_auth_token_session'
const MIGRATION_KEY = 'roam_places_migrated'
const WISHLIST_KEY = 'roam_wishlist'

// "This device has had a successful sign-in at some point." Once set,
// stays set forever (only cleared by manual storage wipe). Used by the
// re-sign-in nudge banner to distinguish "first-time visitor browsing
// anonymously, leave them alone" from "previously authenticated user
// whose session has lapsed, give them a soft prompt to come back."
const HAS_SIGNED_IN_KEY = 'roam_has_signed_in'

const AuthContext = createContext(null)

/**
 * Auth Provider Component
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const getStoredToken = useCallback(() => {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY)
  }, [])

  const storeToken = useCallback((token, remember = true) => {
    if (!token) return
    if (remember) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token)
      sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY)
    } else {
      sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token)
      localStorage.removeItem(TOKEN_STORAGE_KEY)
    }
  }, [])

  const clearStoredToken = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY)
  }, [])

  /**
   * Migrate localStorage data to database on first login
   */
  const migrateLocalData = useCallback(async (token, userId) => {
    const migrationKey = userId ? `${MIGRATION_KEY}_${userId}` : MIGRATION_KEY
    // Skip if already migrated for this account on this device. This must
    // be user-scoped: a shared browser can sign out, collect new anonymous
    // saves, then sign into a different account.
    if (localStorage.getItem(migrationKey)) return

    const savedPlaces = localStorage.getItem(WISHLIST_KEY)
    if (!savedPlaces) {
      localStorage.setItem(migrationKey, 'true')
      return
    }

    try {
      const places = JSON.parse(savedPlaces)
      if (places.length === 0) {
        localStorage.setItem(migrationKey, 'true')
        return
      }

      const response = await fetch('/api/places/saved/migrate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        credentials: 'include',
        body: JSON.stringify({ places })
      })

      if (response.ok) {
        // Clear localStorage after successful migration
        localStorage.removeItem(WISHLIST_KEY)
        localStorage.setItem(migrationKey, 'true')
      }
    } catch (err) {
      console.error('Migration failed:', err)
      // Don't block login on migration failure - will retry next time
    }
  }, [])

  // Check auth status on mount
  useEffect(() => {
    checkAuth()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only run on mount
  }, [])

  /**
   * Check current authentication status
   */
  const checkAuth = useCallback(async () => {
    try {
      setLoading(true)
      const storedToken = getStoredToken()
      const headers = storedToken ? { Authorization: `Bearer ${storedToken}` } : undefined
      const response = await fetch('/api/auth', {
        credentials: 'include',
        headers
      })

      if (response.ok) {
        const data = await response.json()
        setUser(data.user)
        return
      }

      // Only clear the stored token for status codes that genuinely
      // mean "this token is dead" — 401 (unauthenticated) or 403
      // (forbidden). For transient failures (5xx server hiccup, 429
      // rate limit, network blip in catch below) we keep the token
      // and just set user=null so the next checkAuth can recover
      // without forcing the user back through the login flow. This
      // was the root cause behind "updating the app logs me out":
      // a cold-start 502 from the auth endpoint was wiping the JWT
      // on every other open.
      if (response.status === 401 || response.status === 403) {
        clearStoredToken()
      }
      setUser(null)
    } catch (err) {
      // Network failure / fetch threw. Don't clear the token — likely
      // transient (offline, DNS hiccup, Vercel cold-start aborted).
      // Leave the token so checkAuth on the next mount or app foreground
      // can re-validate it.
      console.error('Auth check failed:', err)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [getStoredToken, clearStoredToken])

  // Sync user identity to Sentry + PostHog when it changes — so errors
  // and analytics events carry the user_id/username that hit them.
  // No-ops when env vars aren't set.
  useEffect(() => {
    if (user) {
      identifyUser({ id: user.id, username: user.username, email: user.email })
      analyticsIdentify(user.id, {
        username: user.username,
        email: user.email,
        plan: user.subscription_status === 'active' ? 'premium' : 'free',
      })
      // Attach RevenueCat to this user so purchases follow them across
      // devices. No-op on web / when RC isn't configured.
      identifyUserToRC(user.id)
      // Mark this device as "has had a successful sign-in" so the
      // re-sign-in nudge can target lapsed users without nagging
      // first-time visitors. Idempotent.
      try { localStorage.setItem(HAS_SIGNED_IN_KEY, 'true') } catch { /* private mode */ }
    } else {
      clearUser()
      resetAnalytics()
      logoutFromRC()
    }
  }, [user])

  /**
   * Register with email and password
   */
  const register = useCallback(async (email, password, displayName) => {
    setError(null)
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'register', email, password, displayName })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed')
      }

      setUser(data.user)
      storeToken(data.token, true)
      // Migrate localStorage data to database
      migrateLocalData(data.token, data.user?.id)
      track('signed-up', { method: 'email' })
      return { success: true, user: data.user }
    } catch (err) {
      setError(err.message)
      return { success: false, error: err.message }
    }
  }, [storeToken, migrateLocalData])

  /**
   * Login with email and password
   */
  const login = useCallback(async (email, password, remember = false) => {
    setError(null)
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'login', email, password, remember })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Login failed')
      }

      setUser(data.user)
      storeToken(data.token, remember)
      // Migrate localStorage data to database
      migrateLocalData(data.token, data.user?.id)
      return { success: true, user: data.user }
    } catch (err) {
      setError(err.message)
      return { success: false, error: err.message }
    }
  }, [storeToken, migrateLocalData])

  /**
   * Login with Google
   * @param {string|object} credential - Either ID token string or { accessToken, userInfo }
   */
  const loginWithGoogle = useCallback(async (credential) => {
    setError(null)
    try {
      // Handle both ID token (string) and access token flow (object)
      const body = typeof credential === 'string'
        ? { credential }
        : {
            accessToken: credential.accessToken,
            userInfo: credential.userInfo,
            oauthState: credential.oauthState,
            oauthStateCheck: credential.oauthStateCheck
          }

      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'google', ...body })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Google login failed')
      }

      setUser(data.user)
      storeToken(data.token, true)
      // Migrate localStorage data to database
      migrateLocalData(data.token, data.user?.id)
      if (data.isNewUser) track('signed-up', { method: 'google' })
      return { success: true, user: data.user, isNewUser: data.isNewUser }
    } catch (err) {
      setError(err.message)
      return { success: false, error: err.message }
    }
  }, [storeToken, migrateLocalData])

  /**
   * Sign in with Apple
   * Accepts the identityToken from Apple's JS SDK (web) or Capacitor's
   * Sign in with Apple plugin (native). userInfo carries the name on
   * first sign-in only — Apple never returns it again on subsequent
   * sign-ins, so the client must capture it here and forward it.
   */
  const loginWithApple = useCallback(async ({ identityToken, userInfo, oauthState, oauthStateCheck }) => {
    setError(null)
    // Capture diagnostic info so iOS users get a real error message
    // when the fetch fails — instead of WKWebView's generic "Load failed".
    // The native iOS app surfaces this string directly to the screen, so
    // we know whether the issue is network/CORS/firewall (TypeError from
    // fetch) or a server-side rejection (status code + body).
    const diag = {
      url: typeof window !== 'undefined' ? `${window.location.origin}/api/auth` : '/api/auth',
      token_length: identityToken?.length ?? 0,
      native: typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.(),
    }
    let response
    try {
      response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'apple', identityToken, userInfo, oauthState, oauthStateCheck })
      })
    } catch (fetchErr) {
      // TypeError from fetch = network layer fail. Surface the full
      // error name + message + diagnostic context so the on-screen
      // error tells us exactly what to fix.
      const msg = `fetch failed: ${fetchErr?.name || 'Error'}: ${fetchErr?.message || 'unknown'} | url=${diag.url} native=${diag.native} token_len=${diag.token_length}`
      setError(msg)
      return { success: false, error: msg }
    }

    let data
    try {
      data = await response.json()
    } catch {
      const text = await response.text().catch(() => '<unreadable>')
      const msg = `non-JSON response: HTTP ${response.status} | body=${text.slice(0, 200)}`
      setError(msg)
      return { success: false, error: msg }
    }

    try {
      if (!response.ok) {
        throw new Error(`${data.error || 'Apple sign-in failed'} (HTTP ${response.status})`)
      }
      setUser(data.user)
      storeToken(data.token, true)
      migrateLocalData(data.token, data.user?.id)
      if (data.isNewUser) track('signed-up', { method: 'apple' })
      return { success: true, user: data.user, isNewUser: data.isNewUser }
    } catch (err) {
      setError(err.message)
      return { success: false, error: err.message }
    }
  }, [storeToken, migrateLocalData])

  /**
   * Delete account — App Store Review 5.1.1(v) requirement.
   * Calls the server endpoint with username confirmation, clears local
   * auth state on success. Returns { success, error?, code? }.
   */
  const deleteAccount = useCallback(async (confirmUsername) => {
    setError(null)
    try {
      const storedToken = getStoredToken()
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(storedToken ? { Authorization: `Bearer ${storedToken}` } : {})
        },
        credentials: 'include',
        body: JSON.stringify({ action: 'delete', confirmUsername })
      })
      const data = await response.json()
      if (!response.ok) {
        return { success: false, error: data.error, code: data.code }
      }
      clearStoredToken()
      setUser(null)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }, [getStoredToken, clearStoredToken])

  /**
   * Logout
   */
  const logout = useCallback(async () => {
    try {
      bestEffortUnsubscribePushNotifications()
      await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'logout' })
      })
    } catch (err) {
      console.error('Logout error:', err)
    } finally {
      clearStoredToken()
      setUser(null)
    }
  }, [clearStoredToken])

  /**
   * Update user profile
   */
  const updateProfile = useCallback(async (updates) => {
    setError(null)
    try {
      const storedToken = getStoredToken()
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(storedToken ? { Authorization: `Bearer ${storedToken}` } : {})
        },
        credentials: 'include',
        body: JSON.stringify({ action: 'update', ...updates })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Profile update failed')
      }

      setUser(data.user)
      return { success: true, user: data.user }
    } catch (err) {
      setError(err.message)
      return { success: false, error: err.message }
    }
  }, [getStoredToken])

  /**
   * Clear error
   */
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const value = {
    user,
    loading,
    error,
    isAuthenticated: !!user,
    register,
    login,
    loginWithGoogle,
    loginWithApple,
    logout,
    updateProfile,
    deleteAccount,
    checkAuth,
    clearError
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

/**
 * Hook to use auth context
 */
// eslint-disable-next-line react-refresh/only-export-components -- Hook exported alongside provider
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

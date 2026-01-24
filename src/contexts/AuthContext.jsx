/**
 * Auth Context
 *
 * Provides authentication state and methods throughout the app.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const TOKEN_STORAGE_KEY = 'roam_auth_token'
const SESSION_TOKEN_STORAGE_KEY = 'roam_auth_token_session'
const MIGRATION_KEY = 'roam_places_migrated'
const WISHLIST_KEY = 'roam_wishlist'

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
  const migrateLocalData = useCallback(async (token) => {
    // Skip if already migrated
    if (localStorage.getItem(MIGRATION_KEY)) return

    const savedPlaces = localStorage.getItem(WISHLIST_KEY)
    if (!savedPlaces) {
      localStorage.setItem(MIGRATION_KEY, 'true')
      return
    }

    try {
      const places = JSON.parse(savedPlaces)
      if (places.length === 0) {
        localStorage.setItem(MIGRATION_KEY, 'true')
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
        localStorage.setItem(MIGRATION_KEY, 'true')
        console.log('Migrated saved places to database')
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
      } else {
        setUser(null)
      }
    } catch (err) {
      console.error('Auth check failed:', err)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [getStoredToken])

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
      migrateLocalData(data.token)
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
      migrateLocalData(data.token)
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
        : { accessToken: credential.accessToken, userInfo: credential.userInfo }

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
      migrateLocalData(data.token)
      return { success: true, user: data.user, isNewUser: data.isNewUser }
    } catch (err) {
      setError(err.message)
      return { success: false, error: err.message }
    }
  }, [storeToken, migrateLocalData])

  /**
   * Logout
   */
  const logout = useCallback(async () => {
    try {
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
    logout,
    updateProfile,
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

/**
 * Auth Context
 *
 * Provides authentication state and methods throughout the app.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const TOKEN_STORAGE_KEY = 'roam_auth_token'
const SESSION_TOKEN_STORAGE_KEY = 'roam_auth_token_session'

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
  }, [getStoredToken])

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
      const response = await fetch('/api/auth/me', {
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
  }, [])

  /**
   * Register with email and password
   */
  const register = useCallback(async (email, password, displayName) => {
    setError(null)
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, displayName })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed')
      }

      setUser(data.user)
      storeToken(data.token, true)
      return { success: true, user: data.user }
    } catch (err) {
      setError(err.message)
      return { success: false, error: err.message }
    }
  }, [storeToken])

  /**
   * Login with email and password
   */
  const login = useCallback(async (email, password, remember = false) => {
    setError(null)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, remember })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Login failed')
      }

      setUser(data.user)
      storeToken(data.token, remember)
      return { success: true, user: data.user }
    } catch (err) {
      setError(err.message)
      return { success: false, error: err.message }
    }
  }, [storeToken])

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

      const response = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Google login failed')
      }

      setUser(data.user)
      storeToken(data.token, true)
      return { success: true, user: data.user, isNewUser: data.isNewUser }
    } catch (err) {
      setError(err.message)
      return { success: false, error: err.message }
    }
  }, [storeToken])

  /**
   * Logout
   */
  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      })
    } catch (err) {
      console.error('Logout error:', err)
    } finally {
      clearStoredToken()
      setUser(null)
    }
  }, [clearStoredToken])

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

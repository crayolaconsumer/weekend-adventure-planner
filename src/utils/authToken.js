/**
 * Auth token storage. The token lives in localStorage ("remember me") or
 * sessionStorage (this tab only); AuthContext writes it, everything that
 * calls the API reads it through here.
 */

export const TOKEN_STORAGE_KEY = 'roam_auth_token'
export const SESSION_TOKEN_STORAGE_KEY = 'roam_auth_token_session'

/** The stored JWT, localStorage first, then sessionStorage, else null. */
export function getAuthToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY)
}

/** `{ Authorization: 'Bearer <token>' }`, or `{}` when signed out. */
export function authHeaders() {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

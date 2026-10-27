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

/**
 * Where device copies of a signed-in user's data (cached user, saved list) go:
 * localStorage only for a "keep me signed in" session (token in localStorage);
 * otherwise sessionStorage, so they end with the browser session like the
 * token and nothing of theirs greets the next person on a shared browser.
 */
export function userDataStorage() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) ? localStorage : sessionStorage
  } catch { return sessionStorage }
}

/** A device copy from whichever storage holds it (localStorage first). */
export function readUserData(key) {
  try {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key)
  } catch { return null }
}

/** Write a device copy to the storage the session lives in, and only there. */
export function writeUserData(key, value) {
  try {
    const target = userDataStorage()
    const other = target === localStorage ? sessionStorage : localStorage
    target.setItem(key, value)
    other.removeItem(key)
  } catch { /* private mode / full */ }
}

/** Remove a device copy from both storages. */
export function removeUserData(key) {
  try { localStorage.removeItem(key); sessionStorage.removeItem(key) } catch { /* private mode */ }
}

/**
 * True when this device has a signed-in session: a stored token, or the user
 * AuthContext cached (a web tab can be signed in by cookie alone).
 */
export function isSignedInHere() {
  return Boolean(getAuthToken() || readUserData('roam_cached_user'))
}

/**
 * Query suffix for GETs the CDN shares with guests: signed in, `&viewer=1`
 * gives the request a URL the CDN never stores (api/lib/edgeCache.js), so it
 * can't be answered with the guest copy even when only the cookie is sent.
 */
export function viewerParam() {
  return isSignedInHere() ? '&viewer=1' : ''
}

/** `{ Authorization: 'Bearer <token>' }`, or `{}` when signed out. */
export function authHeaders() {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

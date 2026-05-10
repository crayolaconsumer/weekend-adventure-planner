/**
 * Native bridge — Capacitor runtime detection + fetch interceptor.
 *
 * Why this exists: in a Capacitor build, the app loads from
 * capacitor://localhost (iOS) or https://localhost (Android), not from
 * go-roam.uk. Every fetch('/api/...') call would otherwise hit
 * capacitor://localhost/api/... and 404. This module:
 *
 *   1. Detects Capacitor (isNative)
 *   2. Provides the API origin (getApiBaseUrl)
 *   3. Installs a fetch interceptor that rewrites relative /api/ URLs
 *      to absolute origin and auto-attaches Bearer auth (since
 *      cookies don't reliably preserve across the capacitor://
 *      origin boundary).
 *
 * Single-call install from main.jsx — every existing fetch in the
 * codebase Just Works on native without per-callsite migration.
 */

const API_ORIGIN = 'https://go-roam.uk'
const TOKEN_STORAGE_KEY = 'roam_auth_token'
const SESSION_TOKEN_STORAGE_KEY = 'roam_auth_token_session'

let installed = false

/**
 * Capacitor sets globalThis.Capacitor when the app runs inside a native
 * shell. window.Capacitor.isNativePlatform() returns true on iOS/Android
 * and false in browser dev. We check defensively because the native
 * runtime injects this object asynchronously in some cases.
 */
export function isNative() {
  if (typeof window === 'undefined') return false
  return Boolean(window.Capacitor?.isNativePlatform?.())
}

/**
 * Best-effort platform string: 'ios' | 'android' | 'web'.
 */
export function getPlatform() {
  if (typeof window === 'undefined') return 'web'
  return window.Capacitor?.getPlatform?.() || 'web'
}

/**
 * True when running inside the native iOS Capacitor shell.
 *
 * Used to gate Stripe-based subscription UI per App Store Review
 * Guideline 3.1.1 — digital goods purchases on iOS MUST go through
 * Apple StoreKit / In-App Purchase, not third-party payment
 * processors. Until RevenueCat is wired, all subscribe / manage /
 * upgrade surfaces are hidden or redirected on iOS native, with
 * an informational "Available on the web" state shown instead.
 */
export function isIosNative() {
  return isNative() && getPlatform() === 'ios'
}

/**
 * Where /api/* calls should go. Empty string = same-origin (web), full
 * URL = cross-origin (native). Useful if a callsite needs to construct
 * an absolute URL explicitly (e.g. an <img src> for an authenticated
 * resource that the fetch interceptor can't rewrite).
 */
export function getApiBaseUrl() {
  return isNative() ? API_ORIGIN : ''
}

function getStoredToken() {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(TOKEN_STORAGE_KEY) || sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY) || null
}

/**
 * Install the global fetch interceptor. Idempotent — calling twice is
 * a no-op. Should run before any module makes a fetch call. Called
 * from main.jsx as the first thing after platform detection.
 *
 * Behaviour:
 *   - On web: no-op (returns the original fetch unchanged).
 *   - On native: every fetch with a relative /api/* URL gets rewritten
 *     to absolute go-roam.uk/api/*. Authorization: Bearer header is
 *     auto-attached if not already present (since cookies don't
 *     survive the cross-origin boundary in WKWebView).
 */
export function installFetchInterceptor() {
  if (installed) return
  if (!isNative()) {
    installed = true // mark installed even on web so we don't re-check
    return
  }
  if (typeof globalThis.fetch !== 'function') return

  const originalFetch = globalThis.fetch.bind(globalThis)

  globalThis.fetch = async function patchedFetch(input, init = {}) {
    let url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input?.url
    let request = input

    const isApiCall = typeof url === 'string' && url.startsWith('/api/')
    if (isApiCall) {
      url = API_ORIGIN + url
      // If input was a Request object, we can't just rewrite the URL —
      // need to construct a new Request. Easier: pass the URL string +
      // forward init.
      request = url
    }

    if (!isApiCall) {
      return originalFetch(input, init)
    }

    // Auth header injection — only for our own API
    const headers = new Headers(init.headers || {})
    if (!headers.has('Authorization')) {
      const token = getStoredToken()
      if (token) headers.set('Authorization', `Bearer ${token}`)
    }

    return originalFetch(request, { ...init, headers })
  }

  installed = true
}

/**
 * Helper for code that explicitly needs the absolute URL (e.g. WebSocket,
 * EventSource, <a href>). Returns the input unchanged on web.
 */
export function absoluteApiUrl(path) {
  if (!path?.startsWith('/api/')) return path
  return getApiBaseUrl() + path
}

export default {
  isNative,
  getPlatform,
  getApiBaseUrl,
  installFetchInterceptor,
  absoluteApiUrl,
}

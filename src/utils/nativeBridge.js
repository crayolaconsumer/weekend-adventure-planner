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

// Use the canonical www host — the apex domain 307-redirects to www, and
// the redirect response carries no CORS headers, so WKWebView fetch fails
// with "Load failed" before the redirect can be followed. Going straight
// to www avoids the redirect entirely. This was the root cause of Events,
// Discover, and Apple sign-in all failing silently on native iOS.
const API_ORIGIN = 'https://www.go-roam.uk'

// The canonical public web origin — used for share URLs that recipients
// will click on. Hardcoded rather than read from window.location so
// links shared from native iOS (window.location.origin === 'capacitor://localhost')
// and from preview deploys (window.location.origin === 'https://my-pr-...vercel.app')
// always point at production where the share is actually viewable.
const PUBLIC_WEB_ORIGIN = 'https://www.go-roam.uk'
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

/**
 * Build a fully-qualified URL someone else can click on.
 *
 *   getPublicShareUrl('/plan/share/abc') → 'https://www.go-roam.uk/plan/share/abc'
 *
 * Use this anywhere we generate a URL for copying / sharing / posting
 * to another service — NOT for in-app navigation. iOS Capacitor's
 * window.location.origin is 'capacitor://localhost', which is useless
 * to recipients. Preview deploys would otherwise produce vercel.app
 * URLs that 404 once the deploy expires. This always returns the
 * canonical production URL so share links survive both contexts.
 *
 * Universal Links will eventually let these same URLs open the app
 * directly when the recipient has it installed (apple-app-site-association
 * + applinks: entitlement) — for now they open in Safari which is the
 * correct fallback either way.
 */
export function getPublicShareUrl(path = '') {
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${PUBLIC_WEB_ORIGIN}${cleanPath}`
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
  if (typeof globalThis.fetch !== 'function') return
  installed = true

  const originalFetch = globalThis.fetch.bind(globalThis)

  globalThis.fetch = async function patchedFetch(input, init = {}) {
    // Re-check isNative() at fetch-time, not at install-time. The
    // native runtime injects window.Capacitor asynchronously and we
    // had a regression where main.jsx ran *before* Capacitor was
    // available: isNative() returned false, the interceptor early-
    // returned without patching, every later /api/* call resolved
    // against capacitor://localhost and WKWebView blew up with
    // "TypeError: Load failed". By patching unconditionally and
    // gating the rewrite on each call, we work regardless of the
    // injection-vs-execution ordering Vite happens to land on.
    if (!isNative()) {
      return originalFetch(input, init)
    }

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

    // Auth header injection — only for our own API. Sanitize first:
    // if the stored token contains whitespace/newlines (we've seen
    // Vercel-pasted env vars do this), headers.set() rejects them
    // with an InvalidCharacterError and the entire fetch throws.
    const headers = new Headers(init.headers || {})
    if (!headers.has('Authorization')) {
      const rawToken = getStoredToken()
      const token = rawToken && rawToken.replace(/[\r\n\s]+/g, '')
      if (token) headers.set('Authorization', `Bearer ${token}`)
    }

    return originalFetch(request, { ...init, headers })
  }
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

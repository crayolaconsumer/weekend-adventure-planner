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

interface CapacitorGlobal {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
}

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal
  }
}

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
export function isNative(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(window.Capacitor?.isNativePlatform?.())
}

/**
 * Best-effort platform string: 'ios' | 'android' | 'web'.
 */
export function getPlatform(): string {
  if (typeof window === 'undefined') return 'web'
  return window.Capacitor?.getPlatform?.() || 'web'
}

/**
 * True when running inside the native iOS Capacitor shell.
 *
 * Used to gate Stripe-based subscription UI per App Store Review
 * Guideline 3.1.1 — digital goods purchases on iOS MUST go through
 * Apple StoreKit / In-App Purchase, not third-party payment
 * processors.
 */
export function isIosNative(): boolean {
  return isNative() && getPlatform() === 'ios'
}

/**
 * Where /api/* calls should go. Empty string = same-origin (web), full
 * URL = cross-origin (native).
 */
export function getApiBaseUrl(): string {
  return isNative() ? API_ORIGIN : ''
}

/**
 * Build a fully-qualified URL someone else can click on.
 */
export function getPublicShareUrl(path: string = ''): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${PUBLIC_WEB_ORIGIN}${cleanPath}`
}

function getStoredToken(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(TOKEN_STORAGE_KEY) || sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY) || null
}

/**
 * Install the global fetch interceptor. Idempotent — calling twice is
 * a no-op. Should run before any module makes a fetch call.
 */
export function installFetchInterceptor(): void {
  if (installed) return
  if (typeof globalThis.fetch !== 'function') return
  installed = true

  const originalFetch = globalThis.fetch.bind(globalThis)

  globalThis.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> {
    // Re-check isNative() at fetch-time, not at install-time.
    if (!isNative()) {
      return originalFetch(input, init)
    }

    let url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request)?.url
    let request: RequestInfo | URL = input

    const isApiCall = typeof url === 'string' && url.startsWith('/api/')
    if (isApiCall) {
      url = API_ORIGIN + url
      request = url
    }

    if (!isApiCall) {
      return originalFetch(input, init)
    }

    // Auth header injection — only for our own API. Sanitize first.
    const headers = new Headers(init.headers || {})
    if (!headers.has('Authorization')) {
      const rawToken = getStoredToken()
      const token = rawToken && rawToken.replace(/[\r\n\s]+/g, '')
      if (token) headers.set('Authorization', `Bearer ${token}`)
    }

    // Strip `credentials: 'include'` on native.
    const safeInit: RequestInit = { ...init, headers }
    if (safeInit.credentials === 'include') {
      delete (safeInit as { credentials?: RequestCredentials }).credentials
    }

    return originalFetch(request, safeInit)
  }
}

/**
 * Helper for code that explicitly needs the absolute URL.
 */
export function absoluteApiUrl<T extends string | null | undefined>(path: T): T extends string ? string : T {
  if (typeof path !== 'string' || !path.startsWith('/api/')) {
    return path as T extends string ? string : T
  }
  return (getApiBaseUrl() + path) as T extends string ? string : T
}

export default {
  isNative,
  getPlatform,
  getApiBaseUrl,
  installFetchInterceptor,
  absoluteApiUrl,
}

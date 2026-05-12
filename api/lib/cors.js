/**
 * CORS helper for Vercel API routes.
 *
 * Why: Capacitor native apps load from capacitor://localhost (iOS) or
 * https://localhost (Android), so every API call from a native build is
 * cross-origin. We need to:
 *   1. Echo the Origin header back if it's in the allowlist
 *   2. Handle OPTIONS preflight requests with a 204 + CORS headers
 *   3. Allow Authorization header (we use Bearer auth on native since
 *      cookies don't survive the cross-origin boundary in WKWebView)
 *
 * Usage — wrap any endpoint:
 *
 *   import { withCors } from '../lib/cors.js'
 *   export default withCors(async function handler(req, res) {
 *     // existing endpoint logic
 *   })
 *
 * Or apply manually for endpoints that need to inspect the request
 * before the wrapper short-circuits:
 *
 *   import { applyCors } from '../lib/cors.js'
 *   export default async function handler(req, res) {
 *     if (applyCors(req, res)) return  // returns true if it handled OPTIONS
 *     // ...rest of endpoint
 *   }
 */

export const ALLOWED_ORIGINS = new Set([
  'capacitor://localhost',     // iOS Capacitor default
  'https://localhost',         // Android Capacitor default
  'http://localhost',          // Android emulator + local dev
  'https://go-roam.uk',        // production web
  'https://www.go-roam.uk',    // production web (www variant)
])

const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Requested-With, Accept, Origin'
const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'

/**
 * Apply CORS headers to a response. Returns true if it handled an OPTIONS
 * preflight (caller should return immediately). Returns false otherwise.
 */
export function applyCors(req, res) {
  const origin = req.headers?.origin

  // Echo allowed origins. Reject silently for unknown origins by NOT
  // setting Access-Control-Allow-Origin — browser blocks the request.
  // Vercel preview deployments end in vercel.app — also allow those for
  // QA/testing flows.
  const isCapacitorOrigin = origin === 'capacitor://localhost' || origin === 'https://localhost'

  if (origin) {
    if (ALLOWED_ORIGINS.has(origin) || /^https:\/\/[\w-]+\.vercel\.app$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin') // prevent CDN cache poisoning across origins
      // Capacitor native (capacitor://localhost, https://localhost) uses
      // Bearer-token auth, never cookies. Emitting Allow-Credentials:true
      // on those responses triggers WKWebView's cookie-policy abort
      // (TypeError: Load failed) when the response also carries Set-Cookie
      // — even though the request was non-credentialed. The web origins
      // still need credentialed mode for the same-origin cookie session.
      if (!isCapacitorOrigin) {
        res.setHeader('Access-Control-Allow-Credentials', 'true')
      }
    }
  }

  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS)
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS)
  // Web origins: cache preflight aggressively. Capacitor: do NOT cache —
  // WKWebView holds onto cached preflights for the full Max-Age window
  // (24h) so an old preflight from before today's CORS changes can pin
  // the app to a stale credentialed/cookie response policy and trip
  // every subsequent POST with the opaque "TypeError: Load failed".
  // Setting Max-Age=0 + Cache-Control:no-store forces a fresh preflight
  // every time on native so any future server change takes effect on
  // the very next request without waiting for the cache window to age.
  if (isCapacitorOrigin) {
    res.setHeader('Access-Control-Max-Age', '0')
    res.setHeader('Cache-Control', 'no-store')
  } else {
    res.setHeader('Access-Control-Max-Age', '86400') // 24h cache for preflight
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true
  }

  return false
}

/**
 * Wrapper that applies CORS to a handler and returns the wrapped fn.
 * Drop-in replacement for `export default handler` → `export default withCors(handler)`.
 */
export function withCors(handler) {
  return async function corsWrappedHandler(req, res) {
    if (applyCors(req, res)) return
    return handler(req, res)
  }
}

export default { applyCors, withCors, ALLOWED_ORIGINS }

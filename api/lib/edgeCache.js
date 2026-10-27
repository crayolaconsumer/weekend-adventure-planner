/**
 * Edge (Vercel CDN) caching for GET routes that answer guests and signed-in
 * viewers differently.
 *
 * Vercel's CDN refuses to cache any response whose Vary names Cookie, so the
 * old `Vary: Authorization, Cookie` made these routes always MISS (every guest
 * card tip went to London). Instead:
 *   - A request carrying any credential (Bearer header or roam_token cookie,
 *     valid or not) is answered `private, no-store`: never stored at the edge,
 *     so a personalised answer can never reach another viewer.
 *   - A request with no credential gets the anonymous answer, shared at the
 *     edge, varied on Authorization so a Bearer request never matches a guest
 *     entry (and Vercel never caches a request carrying Authorization).
 * Signed-in clients send Authorization on these routes (web too, see
 * authHeaders()), so they miss the guest copy and get their own.
 *
 * Callers must build the response body from getUserFromRequest(): a request
 * with no token can only ever produce the anonymous body.
 */

import { dropRateLimitHeaders } from './rateLimit.js'

// Card tips and place tips: a removed tip lingers at most one revalidation
// (stale-while-revalidate serves the old copy once, then refreshes).
export const TIPS_CACHE = 'public, s-maxage=60, stale-while-revalidate=600'
// 30-day popularity ranking: barely moves minute to minute.
export const TRENDING_CACHE = 'public, s-maxage=600, stale-while-revalidate=3600'

/**
 * Any credential at all, valid or not: an Authorization header, the web
 * session cookie, or the client's `viewer` marker. A superset of what auth.js
 * extractToken() reads, kept here (not imported) so this module stays free of
 * the DB import auth.js carries.
 *
 * Why the marker: the CDN keys on the URL and ignores cookies, so a signed-in
 * web tab with only the cookie (no stored token, e.g. "keep me signed in" off
 * and a new tab) would get the guest copy. Signed-in clients add ?viewer=1
 * (see isSignedInHere), and a URL carrying it is never stored, whoever sends it.
 */
export function carriesCredential(req) {
  const h = req.headers || {}
  return Boolean(h.authorization) ||
    /(?:^|;)\s*roam_token=/.test(h.cookie || '') ||
    req.query?.viewer !== undefined
}

/**
 * Mark the response shareable at the edge unless the request carries a
 * credential. Returns true when shared.
 */
export function shareIfAnonymous(req, res, cacheControl) {
  if (carriesCredential(req)) {
    res.setHeader('Cache-Control', 'private, no-store')
    return false
  }
  dropRateLimitHeaders(res) // per-visitor counters must not be served to everyone
  res.setHeader('Cache-Control', cacheControl)
  const vary = res.getHeader?.('Vary')
  res.setHeader('Vary', [vary, 'Authorization'].filter(Boolean).join(', '))
  return true
}

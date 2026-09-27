/**
 * Load-test requests: header `x-roam-loadtest` equal to LOADTEST_SECRET (>= 32
 * chars). They skip the allowlisted per-IP rate limits below (one runner IP
 * stands in for thousands of users) and get the crawlers' cache-only treatment, so a test measures
 * ROAM and never spends the free Overpass / Wikimedia quotas. Inert whenever
 * LOADTEST_SECRET is unset: it is added for a run and removed after.
 */
import { timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'

export function isLoadTest(req) {
  const secret = process.env.LOADTEST_SECRET
  const got = req?.headers?.['x-roam-loadtest']
  if (typeof secret !== 'string' || secret.length < 32 || typeof got !== 'string' || got.length !== secret.length) return false
  return timingSafeEqual(Buffer.from(got), Buffer.from(secret))
}

/**
 * The only rate limits a load test may skip: the read-heavy paths it drives
 * from one runner IP. Keys are the keySuffix (applyRateLimit) or name
 * (applySharedRateLimit) used at each call site. Anything that creates
 * accounts, deletes, uploads, looks up share codes or spends paid quota
 * (register, google, apple, delete, upload, share, ticketmaster, ...) stays
 * limited even with the secret, so a leaked secret buys little.
 */
export const LOADTEST_BYPASS = new Set([
  'login', // auth/index.js (per-IP only; the per-account cap still applies)
  'places:swiped', 'places:saved', 'places:trending', 'places:image-resolve',
  'stats:update', // users/stats.js
  'notifications',
  'social:requests', 'social:follow',
  'contrib:batch',
  'users:profile', // users/[username].js
  'overpass_proxy', 'overpass', // overpass/nearby.js, per-instance and shared
  'town', 'town_near' // town.js; cache-only for load tests, never Nominatim/Overpass
])

export function bypassesRateLimit(req, name) {
  return LOADTEST_BYPASS.has(name) && isLoadTest(req)
}

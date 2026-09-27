/**
 * Server-side runtime feature kill-switch.
 *
 * Lets us disable a feature in production WITHOUT a deploy by writing a
 * single JSON blob to the KV key `roam:flags`, e.g. to shed load when an
 * upstream (Overpass) is struggling or to pause a misbehaving feature.
 *
 * Design constraints:
 *   1. EVERY feature defaults to ENABLED (true). The kill-switch only ever
 *      turns things OFF. A missing/absent flag file means "business as
 *      usual" — never an accidental outage. Numeric flags (poiDbPct, a rollout
 *      percentage) are the exception: they default to 0, so a failed read
 *      turns the NEW path off and keeps the old one (fail closed).
 *   2. KV is a soft layer (see kvCache.js). This module must NEVER throw and
 *      must NEVER hard-depend on KV: on any error (KV down, malformed JSON,
 *      whatever) it returns the safe DEFAULTS — i.e. fail OPEN, everything on.
 *   3. A short in-memory cache (~30s) avoids a KV round-trip on every request
 *      while still letting a kill-switch take effect within a window.
 *
 * Integration into individual endpoints is deliberately NOT done here.
 */

import { cacheGet } from './kvCache.js'

const KV_FLAGS_KEY = 'roam:flags'

// Safe defaults — every feature ON. This object is the source of truth for
// which flag names exist; the KV blob is merged OVER it, so unknown keys in
// KV are ignored and missing keys keep their default.
const DEFAULTS = Object.freeze({
  overpassProxy: true,
  contributionsUpload: true,
  pushNudges: true,
  promotedEvents: true,
  promotedEventPush: true,
  // Percentage (0-100) of Discover tiles served from the POI table (api/lib/poiQuery.js)
  poiDbPct: 0,
  // Percentage (0-100) of tiles whose KV/Overpass answer is also queried from
  // the POI table and compared (shadow log only, never served)
  poiShadowPct: 0,
})

const CACHE_TTL_MS = 30 * 1000

let cachedFlags = null
let cachedAt = 0

/**
 * Read the runtime feature flags, merged over the safe DEFAULTS.
 *
 * Never throws — on any error returns a copy of DEFAULTS (fail-open).
 * Result is cached in-memory for ~30s. A KV value is honoured only when its
 * type matches the default's: booleans for boolean flags, finite numbers
 * (whole numbers, clamped to 0-100) for numeric ones. Anything else keeps
 * the default.
 */
export async function getFlags() {
  const now = Date.now()
  if (cachedFlags && now - cachedAt < CACHE_TTL_MS) {
    return cachedFlags
  }

  try {
    const stored = await cacheGet(KV_FLAGS_KEY)
    const merged = { ...DEFAULTS }

    if (stored && typeof stored === 'object') {
      for (const key of Object.keys(DEFAULTS)) {
        if (typeof DEFAULTS[key] === 'number') {
          if (Number.isFinite(stored[key])) merged[key] = Math.min(100, Math.max(0, Math.trunc(stored[key])))
        } else if (typeof stored[key] === 'boolean') {
          merged[key] = stored[key]
        }
      }
    }

    cachedFlags = merged
    cachedAt = now
    return merged
  } catch (err) {
    // Fail open: a flag-system failure must never disable a feature.
    console.warn('[flags] getFlags failed, falling back to defaults:', err.message)
    return { ...DEFAULTS }
  }
}

/**
 * The cached flags if they are fresh, else null. Synchronous: for hot paths
 * that must not wait on KV (they call getFlags() to refresh in the background).
 */
export function peekFlags() {
  return cachedFlags && Date.now() - cachedAt < CACHE_TTL_MS ? cachedFlags : null
}

/**
 * Convenience: is a single feature enabled? Unknown names default to true
 * (fail-open) so a typo never silently disables something.
 */
export async function isFeatureEnabled(name) {
  const flags = await getFlags()
  return flags[name] !== false
}

export default { getFlags, peekFlags, isFeatureEnabled }

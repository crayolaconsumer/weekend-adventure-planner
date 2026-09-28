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
 *      whatever) a warm instance keeps its last-known-good flags and a cold
 *      one returns the safe DEFAULTS — i.e. fail OPEN, everything on.
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
export const DEFAULTS = Object.freeze({
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
  // Percentage (0-100) of served dense Discover tiles cut to the relevance cap
  // (shared/poiRank.mjs); the rest are served as before. Shadow always measures it
  poiCapPct: 0,
})

const CACHE_TTL_MS = 30 * 1000
// The Upstash client has no timeout and retries network errors for seconds.
// Warm: a slower read counts as an outage and last-known-good is kept.
// Cold: nothing to fall back on but DEFAULTS, so wait out the client's retries.
const KV_TIMEOUT_MS = 2000
const COLD_KV_TIMEOUT_MS = 8000

let cachedFlags = null
let cachedAt = 0 // start of the read behind the cached copy, or of a failed read that restarted its window
let loading = null // the one KV read in flight on this instance
let loadingAt = 0
let readAt = -1 // start time of the read that produced cachedFlags

/**
 * Read the runtime feature flags, merged over the safe DEFAULTS.
 *
 * Never throws. Cached in-memory for ~30 s; past that, callers wait for one
 * shared KV read (max 2 s warm, 8 s cold), so a kill switch lands within ~30 s
 * on a busy instance and on the next call on an idle one.
 *
 * When KV has no blob, fails or times out (cacheGet returns null on a KV
 * error or exhausted quota), a warm instance keeps its last-known-good flags
 * and restarts the 30 s window, so an Upstash outage mid-campaign cannot
 * reset poiDbPct to 0 and send every Discover tile back to Overpass, and costs
 * at most one KV read per instance per window. Only a cold instance falls back
 * to DEFAULTS (fail-open). A read that lands after its timeout still updates
 * the cache. Hot paths that must never wait use peekFlags().
 *
 * A KV value is honoured only when its type matches the default's: booleans
 * for boolean flags, finite numbers (whole numbers, clamped to 0-100) for
 * numeric ones. Anything else keeps the default.
 */
export async function getFlags() {
  const now = Date.now()
  if (cachedFlags && now - cachedAt < CACHE_TTL_MS) return cachedFlags
  const timeout = cachedFlags ? KV_TIMEOUT_MS : COLD_KV_TIMEOUT_MS
  // One read at a time; a read older than its timeout (say, frozen with the
  // function between invocations) is abandoned for a new one
  if (!loading || now - loadingAt > timeout) {
    loadingAt = now
    const read = readFlags(now, timeout).catch(() => cachedFlags || { ...DEFAULTS }).finally(() => { if (loading === read) loading = null })
    loading = read
  }
  return loading
}

function merge(stored) {
  const merged = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    if (typeof DEFAULTS[key] === 'number') {
      if (Number.isFinite(stored[key])) merged[key] = Math.min(100, Math.max(0, Math.trunc(stored[key])))
    } else if (typeof stored[key] === 'boolean') {
      merged[key] = stored[key]
    }
  }
  return merged
}

async function readFlags(startedAt, timeout) {
  const read = Promise.resolve().then(() => cacheGet(KV_FLAGS_KEY)).then(stored => {
    // Applied whenever it lands, even after the timeout, unless a newer read got there first
    // An object with none of our keys ({}, an array) is garbage, not "all defaults":
    // the admin endpoint merges each edit into the stored blob, so a real one always has some
    if (!stored || typeof stored !== 'object' || !Object.keys(DEFAULTS).some(k => k in stored)) return null
    if (startedAt < readAt) return null
    readAt = startedAt
    cachedFlags = merge(stored)
    // Never older than it was: a read landing late (after failed reads restarted
    // the window) must not make last-known-good look expired
    cachedAt = Math.max(cachedAt, startedAt)
    return cachedFlags
  }, err => {
    console.warn('[flags] getFlags failed:', err?.message)
    return null
  })
  let timer
  const flags = await Promise.race([read, new Promise(resolve => { timer = setTimeout(resolve, timeout, null) })])
  clearTimeout(timer)
  if (flags) return flags
  // No blob, KV error or timeout. Fail open: a flag-system failure must never
  // disable a feature. Warm: keep last-known-good. Cold: DEFAULTS, cached like
  // a read so a down KV costs one read per window here too.
  // ponytail: a deliberately deleted roam:flags key is also treated as an outage on warm instances; set flags, don't delete them
  console.warn('[flags] no flag blob from KV, keeping last-known-good flags or defaults')
  cachedFlags = cachedFlags || { ...DEFAULTS }
  // Restart the window from when this read began, not when its timer fired:
  // after a freeze the overdue timer runs at thaw and must not make old flags look fresh
  cachedAt = Math.max(cachedAt, startedAt)
  return cachedFlags
}

/**
 * Last-known-good flags, never waiting on KV: for hot paths (Discover, photo
 * lookups) whose flags are rollout percentages. A copy past its 30 s TTL is
 * still returned and starts the background refresh, so a KV outage, a slow
 * read or a thaw after a freeze never drops these paths back to DEFAULTS; with
 * KV healthy a change lands on the next request. Null only on a cold instance:
 * callers then wait briefly on getFlags(). Kill switches go through getFlags().
 */
export function peekFlags() {
  if (cachedFlags && Date.now() - cachedAt >= CACHE_TTL_MS) getFlags().catch(() => {})
  return cachedFlags
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

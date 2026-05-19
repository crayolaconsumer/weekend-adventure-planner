/**
 * Upstream-response cache backed by Vercel KV (Upstash Redis).
 *
 * Used by upstream proxies (Overpass, OpenTripMap, etc.) to avoid
 * re-hitting third-party APIs for queries we've already answered.
 * Critical at scale because:
 *   1. Most upstream APIs we rely on are community-funded (OSM) or
 *      free-tier (OTM) and will rate-limit or ban our IP range if we
 *      hammer them. Caching means each unique query pays the upstream
 *      cost at most once per TTL window, regardless of how many users
 *      ask for the same tile.
 *   2. Vercel function GB-hours add up when a 20s Overpass call runs
 *      thousands of times. Cache hits return in ~30ms.
 *
 * The cache is intentionally a soft layer: if KV env vars are absent,
 * or any KV operation fails, callers transparently fall back to hitting
 * the upstream API as before. Cache failures must never break a feature.
 *
 * Env vars (any naming convention works — Vercel Marketplace and the
 * legacy KV integration use different names for the same Upstash store):
 *   - KV_REST_API_URL   / KV_REST_API_TOKEN     (legacy "Vercel KV")
 *   - UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN  (Marketplace)
 */

import { Redis } from '@upstash/redis'
import { createHash } from 'node:crypto'

let cachedClient = null
let initAttempted = false

function getClient() {
  if (initAttempted) return cachedClient
  initAttempted = true

  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    return null
  }

  try {
    cachedClient = new Redis({ url, token })
    return cachedClient
  } catch (err) {
    console.warn('[kvCache] Failed to initialise Upstash client:', err.message)
    return null
  }
}

/**
 * True when KV is provisioned and reachable (best-effort — only checks
 * env presence, not connectivity).
 */
export function isCacheEnabled() {
  return getClient() !== null
}

/**
 * SHA-1 hash of an arbitrary string, suitable as a cache key.
 * SHA-1 is not used for security here — only for deterministic short
 * keys. 40 hex chars is plenty short for Redis.
 */
export function hashKey(value) {
  return createHash('sha1').update(value).digest('hex')
}

/**
 * Get a cached JSON value. Returns null on miss, on KV failure, or if
 * KV is not provisioned.
 */
export async function cacheGet(key) {
  const client = getClient()
  if (!client) return null

  try {
    const raw = await client.get(key)
    if (raw == null) return null
    // We stored a JSON string in cacheSet; parse it back here. If
    // some operator wrote a raw value via the Upstash console, the
    // parse will throw — fall back to returning the raw value rather
    // than treating that as a hard error.
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw)
      } catch {
        return raw
      }
    }
    return raw
  } catch (err) {
    console.warn(`[kvCache] get(${key}) failed:`, err.message)
    return null
  }
}

/**
 * Store a JSON value with a TTL (in seconds). Silently no-ops if KV
 * is unavailable or if the payload exceeds the configured size limit.
 *
 * Upstash free tier caps individual requests at 1 MB. Overpass
 * responses for dense 30 km bboxes can exceed that — we skip caching
 * those rather than failing the whole request. The next caller pays
 * the upstream cost (same as today). 900 KB leaves headroom for the
 * envelope JSON Redis itself adds.
 */
const MAX_CACHE_PAYLOAD_BYTES = 900 * 1024

export async function cacheSet(key, value, ttlSeconds) {
  const client = getClient()
  if (!client) return false

  try {
    // JSON-encode once for the size check. Upstash's client also
    // serialises objects, but it doesn't expose the encoded length
    // and we want to skip oversized writes before the network call.
    const serialised = JSON.stringify(value)
    if (serialised.length > MAX_CACHE_PAYLOAD_BYTES) {
      console.warn(
        `[kvCache] payload too large (${serialised.length} bytes) for key ${key}, skipping cache`
      )
      return false
    }

    // Store as a JSON string — cacheGet matches by JSON.parse'ing on
    // read. We do the encode/decode ourselves rather than let the SDK
    // handle it because the SDK's auto-deserialisation has surprised
    // us in the past on edge cases (booleans, large numbers).
    await client.set(key, serialised, { ex: ttlSeconds })
    return true
  } catch (err) {
    console.warn(`[kvCache] set(${key}) failed:`, err.message)
    return false
  }
}

export default {
  cacheGet,
  cacheSet,
  hashKey,
  isCacheEnabled,
}

/**
 * Rate Limiting Utility
 *
 * In-memory rate limiter for serverless functions.
 * Uses a sliding window algorithm with TTL-based cleanup.
 *
 * In-memory limits are per instance, so they are the cheap first layer.
 * applySharedRateLimit() below adds a cross-instance ceiling in KV for the
 * routes that cost real money or upstream quota.
 */

import { getClient as getKvClient } from './kvCache.js'

// Store: Map of key -> { count, windowStart, blocked, blockedUntil }
const store = new Map()

// Cleanup old entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000
let lastCleanup = Date.now()

/**
 * Clean up expired entries
 */
function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return

  for (const [key, data] of store.entries()) {
    // Remove if window expired and not blocked
    if (data.windowStart + data.windowMs < now && (!data.blockedUntil || data.blockedUntil < now)) {
      store.delete(key)
    }
  }
  lastCleanup = now
}

/**
 * Rate limit configuration presets
 */
export const RATE_LIMITS = {
  // Auth endpoints - stricter limits
  AUTH_LOGIN: { windowMs: 15 * 60 * 1000, max: 10, blockDurationMs: 30 * 60 * 1000 }, // 10 per 15 min, block 30 min
  AUTH_REGISTER: { windowMs: 60 * 60 * 1000, max: 5, blockDurationMs: 60 * 60 * 1000 }, // 5 per hour, block 1 hour
  AUTH_GOOGLE: { windowMs: 15 * 60 * 1000, max: 20, blockDurationMs: 15 * 60 * 1000 }, // 20 per 15 min

  // Share code lookup - prevent enumeration
  SHARE_CODE_LOOKUP: { windowMs: 60 * 1000, max: 30, blockDurationMs: 5 * 60 * 1000 }, // 30 per min, block 5 min

  // General API - more lenient
  API_GENERAL: { windowMs: 60 * 1000, max: 100, blockDurationMs: 60 * 1000 }, // 100 per min
  API_WRITE: { windowMs: 60 * 1000, max: 30, blockDurationMs: 2 * 60 * 1000 }, // 30 writes per min

  // Contributions/social
  CONTRIBUTION: { windowMs: 60 * 60 * 1000, max: 20, blockDurationMs: 30 * 60 * 1000 }, // 20 per hour
  VOTE: { windowMs: 60 * 1000, max: 60, blockDurationMs: 5 * 60 * 1000 }, // 60 votes per min
  FOLLOW: { windowMs: 60 * 60 * 1000, max: 50, blockDurationMs: 60 * 60 * 1000 } // 50 follows per hour
}

/**
 * Check rate limit for a key
 * @param {string} key - Unique identifier (usually IP or IP+endpoint or userId)
 * @param {Object} config - Rate limit configuration
 * @returns {{ allowed: boolean, remaining: number, resetAt: number, blocked: boolean }}
 */
export function checkRateLimit(key, config) {
  cleanup()

  const now = Date.now()
  const { windowMs, max, blockDurationMs = 0 } = config

  let data = store.get(key)

  // Check if currently blocked
  if (data?.blockedUntil && data.blockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: data.blockedUntil,
      blocked: true,
      retryAfter: Math.ceil((data.blockedUntil - now) / 1000)
    }
  }

  // Initialize or reset window if expired
  if (!data || data.windowStart + windowMs < now) {
    data = {
      count: 0,
      windowStart: now,
      windowMs,
      blocked: false,
      blockedUntil: null
    }
    store.set(key, data)
  }

  // Increment count
  data.count++

  // Check if limit exceeded
  if (data.count > max) {
    // Apply block if configured
    if (blockDurationMs > 0) {
      data.blocked = true
      data.blockedUntil = now + blockDurationMs
    }

    return {
      allowed: false,
      remaining: 0,
      resetAt: data.blockedUntil || data.windowStart + windowMs,
      blocked: data.blocked,
      retryAfter: Math.ceil(((data.blockedUntil || data.windowStart + windowMs) - now) / 1000)
    }
  }

  return {
    allowed: true,
    remaining: max - data.count,
    resetAt: data.windowStart + windowMs,
    blocked: false
  }
}

/**
 * Get rate limit key from request
 * Uses X-Forwarded-For header (set by Vercel) or falls back to connection IP
 * @param {Request} req - HTTP request
 * @param {string} [suffix] - Optional suffix to namespace the key
 * @returns {string} Rate limit key
 */
export function getRateLimitKey(req, suffix = '') {
  // Vercel sets X-Forwarded-For, X-Real-IP
  const forwarded = req.headers['x-forwarded-for']
  const ip = forwarded
    ? forwarded.split(',')[0].trim()
    : req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown'

  return suffix ? `${ip}:${suffix}` : ip
}

/**
 * Apply rate limit to a request
 * Returns error response if rate limited, null if allowed
 * @param {Request} req - HTTP request
 * @param {Response} res - HTTP response
 * @param {Object} config - Rate limit config from RATE_LIMITS
 * @param {string} [keySuffix] - Optional suffix for the rate limit key
 * @returns {Object|null} Error response object or null if allowed
 */
export function applyRateLimit(req, res, config, keySuffix = '') {
  const key = getRateLimitKey(req, keySuffix)
  const result = checkRateLimit(key, config)

  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', config.max)
  res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining))
  res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000))

  if (!result.allowed) {
    res.setHeader('Retry-After', result.retryAfter)
    return {
      status: 429,
      error: result.blocked
        ? 'Too many requests. You have been temporarily blocked.'
        : 'Too many requests. Please try again later.',
      retryAfter: result.retryAfter
    }
  }

  return null
}

/**
 * Cross-instance limit in KV (Upstash): fixed window, one INCR + EXPIRE
 * round trip. Fails OPEN: no KV, or any KV error, allows the request, so a
 * KV outage can never take the routes down with it.
 * @param {{ max: number, windowSec: number }} config
 * @param {string} name - route namespace for the key
 * @returns {Promise<Object|null>} 429 payload, or null if allowed
 */
export async function applySharedRateLimit(req, res, { max, windowSec }, name, client = getKvClient()) {
  if (!client) return null
  const nowSec = Math.floor(Date.now() / 1000)
  const window = Math.floor(nowSec / windowSec)
  const key = `rl:${name}:${getRateLimitKey(req)}:${window}`
  let count
  try {
    const results = await client.pipeline().incr(key).expire(key, windowSec).exec()
    count = results[0]
  } catch (err) {
    console.warn(`[rateLimit] shared ${name} failed open:`, err.message)
    return null
  }
  if (!(Number(count) > max)) return null
  const retryAfter = (window + 1) * windowSec - nowSec
  res.setHeader('Retry-After', retryAfter)
  return { status: 429, error: 'Too many requests. Please try again later.', retryAfter }
}

export default {
  RATE_LIMITS,
  checkRateLimit,
  getRateLimitKey,
  applyRateLimit,
  applySharedRateLimit
}

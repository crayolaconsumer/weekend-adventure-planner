/**
 * GET/POST /api/admin/flags
 *
 * Admin view + control of the runtime feature kill-switches (the
 * `roam:flags` KV blob read by api/lib/flags.js). GET returns the current
 * effective flags; POST persists a change (a KV write — no deploy). A
 * change goes live within ~60s (the 30s in-memory + 30s edge cache windows).
 *
 * Same security posture as /api/admin/dashboard: 404 on every reject path,
 * IP rate limit, Origin/Referer gate, is_admin enforcement.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { withCors, ALLOWED_ORIGINS } from '../lib/cors.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { cacheGet, cacheSet, isCacheEnabled } from '../lib/kvCache.js'

const NOT_FOUND = (res) => res.status(404).json({ error: 'Not found' })
const KV_FLAGS_KEY = 'roam:flags'
// Effectively persistent — a kill-switch must not silently expire. If KV
// ever drops the key, getFlags() falls back to all-ON (safe by design).
const FLAG_TTL_SECONDS = 10 * 365 * 24 * 60 * 60
// Mirrors DEFAULTS in api/lib/flags.js — every feature ON by default.
const DEFAULTS = Object.freeze({
  discover: true,
  overpassProxy: true,
  contributionsUpload: true,
  pushNudges: true,
})

function clientIp(req) {
  const fwd = req.headers?.['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim()
  return req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown'
}

function isOriginAllowed(req) {
  const candidate = req.headers?.origin || req.headers?.referer
  if (!candidate) return false
  for (const allowed of ALLOWED_ORIGINS) {
    if (candidate === allowed || candidate.startsWith(allowed + '/')) return true
  }
  return false
}

async function readEffective() {
  const effective = { ...DEFAULTS }
  if (!isCacheEnabled()) return effective
  try {
    const stored = await cacheGet(KV_FLAGS_KEY)
    if (stored && typeof stored === 'object') {
      for (const k of Object.keys(DEFAULTS)) {
        if (typeof stored[k] === 'boolean') effective[k] = stored[k]
      }
    }
  } catch {
    // fall back to defaults
  }
  return effective
}

async function handler(req, res) {
  const ipKey = clientIp(req)
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, `admin-flags-ip:${ipKey}`)
  if (rateLimitError) return NOT_FOUND(res)

  if (!isOriginAllowed(req)) return NOT_FOUND(res)

  const user = await getUserFromRequest(req)
  if (!user || !user.is_admin) return NOT_FOUND(res)

  if (req.method === 'GET') {
    return res.status(200).json({ flags: await readEffective(), defaults: DEFAULTS, kvEnabled: isCacheEnabled() })
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    if (!isCacheEnabled()) {
      return res.status(503).json({ error: 'KV not configured — cannot persist flags' })
    }
    const incoming = (req.body && typeof req.body === 'object') ? req.body.flags : null
    if (!incoming || typeof incoming !== 'object') {
      return res.status(400).json({ error: 'Body must be { flags: { <name>: <boolean> } }' })
    }
    const next = await readEffective()
    let changed = false
    for (const k of Object.keys(DEFAULTS)) {
      if (typeof incoming[k] === 'boolean' && incoming[k] !== next[k]) {
        next[k] = incoming[k]
        changed = true
      }
    }
    const ok = await cacheSet(KV_FLAGS_KEY, next, FLAG_TTL_SECONDS)
    if (!ok) return res.status(500).json({ error: 'Failed to persist flags' })
    return res.status(200).json({ flags: next, defaults: DEFAULTS, changed, note: 'Live within ~60s (cache TTLs).' })
  }

  return NOT_FOUND(res)
}

export default withCors(handler)

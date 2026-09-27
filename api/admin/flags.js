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

import { withCors } from '../lib/cors.js'
import { RATE_LIMITS } from '../lib/rateLimit.js'
import { guardAdmin, NOT_FOUND } from '../lib/adminGuard.js'
import { cacheGet, cacheSet, isCacheEnabled, getClient } from '../lib/kvCache.js'

const KV_FLAGS_KEY = 'roam:flags'
// Effectively persistent — a kill-switch must not silently expire. If KV
// ever drops the key, getFlags() falls back to all-ON (safe by design).
const FLAG_TTL_SECONDS = 10 * 365 * 24 * 60 * 60
// Mirrors DEFAULTS in api/lib/flags.js — every feature ON by default.
const DEFAULTS = Object.freeze({
  overpassProxy: true,
  contributionsUpload: true,
  pushNudges: true,
})

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
  if (!(await guardAdmin(req, res, { key: 'admin-flags-ip', limit: RATE_LIMITS.API_GENERAL }))) return

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
    // MERGE into the stored blob: numeric rollout flags (poiDbPct, poiShadowPct)
    // and any key this editor doesn't know must survive a boolean edit. Read with
    // the raw client: cacheGet turns a KV error into null, and writing after a
    // failed read would wipe every other flag.
    let stored
    try {
      stored = await getClient()?.get(KV_FLAGS_KEY)
      if (typeof stored === 'string') stored = JSON.parse(stored)
      if (stored != null && (typeof stored !== 'object' || Array.isArray(stored))) throw new Error('not an object')
    } catch {
      return res.status(503).json({ error: 'Could not read current flags; nothing written' })
    }
    const current = await readEffective()
    const next = { ...(stored || {}) }
    delete next.poiGen // the cache generation has its own key (roam:poiGen); never written from here
    let changed = false
    for (const k of Object.keys(DEFAULTS)) {
      if (typeof incoming[k] === 'boolean' && incoming[k] !== current[k]) {
        next[k] = incoming[k]
        changed = true
      }
    }
    const ok = await cacheSet(KV_FLAGS_KEY, next, FLAG_TTL_SECONDS)
    if (!ok) return res.status(500).json({ error: 'Failed to persist flags' })
    const flags = Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, typeof next[k] === 'boolean' ? next[k] : DEFAULTS[k]]))
    return res.status(200).json({ flags, defaults: DEFAULTS, changed, note: 'Live within ~60s (cache TTLs).' })
  }

  return NOT_FOUND(res)
}

export default withCors(handler)

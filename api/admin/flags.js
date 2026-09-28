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
import { DEFAULTS } from '../lib/flags.js' // the one list of flag names: one missing here can't be set

const KV_FLAGS_KEY = 'roam:flags'
// Effectively persistent — a kill-switch must not silently expire. If KV
// ever drops the key, warm instances keep their last-known-good flags and
// cold ones start from DEFAULTS (all-ON, POI percentages 0).
const FLAG_TTL_SECONDS = 10 * 365 * 24 * 60 * 60
const isPct = v => Number.isInteger(v) && v >= 0 && v <= 100
const valid = (k, v) => (typeof DEFAULTS[k] === 'number' ? isPct(v) : typeof v === 'boolean')

// What api/lib/flags.js actually serves from a stored blob: numbers clamped, not dropped
const served = (k, v) => typeof DEFAULTS[k] === 'number'
  ? (Number.isFinite(v) ? Math.min(100, Math.max(0, Math.trunc(v))) : DEFAULTS[k])
  : (typeof v === 'boolean' ? v : DEFAULTS[k])
const effective = stored => Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, served(k, stored?.[k])]))

async function handler(req, res) {
  if (!(await guardAdmin(req, res, { key: 'admin-flags-ip', limit: RATE_LIMITS.API_GENERAL }))) return

  if (req.method === 'GET') {
    let stored = null
    if (isCacheEnabled()) {
      try { stored = await cacheGet(KV_FLAGS_KEY) } catch { /* fall back to defaults */ }
    }
    return res.status(200).json({ flags: effective(stored), defaults: DEFAULTS, kvEnabled: isCacheEnabled() })
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    if (!isCacheEnabled()) {
      return res.status(503).json({ error: 'KV not configured — cannot persist flags' })
    }
    const incoming = (req.body && typeof req.body === 'object') ? req.body.flags : null
    if (!incoming || typeof incoming !== 'object') {
      return res.status(400).json({ error: 'Body must be { flags: { <name>: <boolean | 0-100> } }' })
    }
    const bad = Object.keys(incoming).find(k => Object.hasOwn(DEFAULTS, k) && !valid(k, incoming[k]))
    if (bad) return res.status(400).json({ error: `${bad} must be ${typeof DEFAULTS[bad] === 'number' ? 'an integer 0-100' : 'a boolean'}` })
    // MERGE into the stored blob: keys not in this edit (and any key this
    // editor doesn't know) must survive it. Read with
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
    const next = { ...(stored || {}) }
    let changed = false
    for (const k of Object.keys(DEFAULTS)) {
      // Against the raw value: a stored 150 serves 100 but reads back as 100,
      // so comparing effective values could skip the kill switch's write
      if (Object.hasOwn(incoming, k) && incoming[k] !== stored?.[k]) {
        next[k] = incoming[k]
        changed = true
      }
    }
    const ok = await cacheSet(KV_FLAGS_KEY, next, FLAG_TTL_SECONDS)
    if (!ok) return res.status(500).json({ error: 'Failed to persist flags' })
    return res.status(200).json({ flags: effective(next), defaults: DEFAULTS, changed, note: 'Live within ~60s (cache TTLs).' })
  }

  return NOT_FOUND(res)
}

export default withCors(handler)

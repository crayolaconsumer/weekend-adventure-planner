/**
 * Shared gate for every /api/admin/* route.
 *
 * Order matters and is part of the security posture:
 *   1. IP-keyed rate limit BEFORE auth, so anonymous probes can't burn
 *      compute hunting for timing oracles or route existence.
 *   2. Origin/Referer gate (CSRF defence; admin is only ever called from
 *      our own frontend). No header at all = unknown caller = reject.
 *   3. Auth + is_admin. Banned admins fail too: getUserFromRequest
 *      returns null for banned users.
 * Every reject is the same 404 body a missing Vercel route returns, so
 * the admin surface is indistinguishable from "not there".
 */

import { getUserFromRequest } from './auth.js'
import { queryOne } from './db.js'
import { ALLOWED_ORIGINS } from './cors.js'
import { applyRateLimit, getRateLimitKey, RATE_LIMITS } from './rateLimit.js'

export const NOT_FOUND = (res) => res.status(404).json({ error: 'Not found' })

export function isOriginAllowed(req) {
  const candidate = req.headers?.origin || req.headers?.referer
  if (!candidate) return false
  for (const allowed of ALLOWED_ORIGINS) {
    if (candidate === allowed || candidate.startsWith(allowed + '/')) return true
  }
  return false
}

/**
 * @param {{ key: string, limit?: object }} opts key namespaces the rate
 *   limit bucket (e.g. 'admin-users-ip'); limit defaults to API_GENERAL.
 * @returns {Promise<{ user: object, ip: string } | null>} null means a 404
 *   has already been sent and the caller must return.
 */
export async function guardAdmin(req, res, { key, limit = RATE_LIMITS.API_GENERAL }) {
  const ip = getRateLimitKey(req)
  if (applyRateLimit(req, res, limit, `${key}:${ip}`)) {
    NOT_FOUND(res)
    return null
  }
  if (!isOriginAllowed(req)) {
    NOT_FOUND(res)
    return null
  }
  const user = await getUserFromRequest(req)
  if (!user || !user.is_admin) {
    NOT_FOUND(res)
    return null
  }
  return { user, ip }
}

/** Destructive admin actions need a login within the last 30 minutes. */
export async function requireFreshLogin(userId) {
  const fresh = await queryOne('SELECT last_login_at FROM users WHERE id = ?', [userId])
  const ageMin = fresh?.last_login_at
    ? (Date.now() - new Date(fresh.last_login_at).getTime()) / 60000
    : Infinity
  return ageMin <= 30
}

/**
 * GET /api/admin/dashboard
 *
 * Aggregate stats for the admin landing page. One round-trip so the
 * dashboard isn't a parade of N requests when the operator hits /admin.
 *
 * Same security posture as /api/admin/reports — 404 on every reject
 * path, IP rate limit, Origin/Referer gate, is_admin enforcement.
 *
 * Returns:
 *   reports:   { open, critical_open, high_open, actioned_30d }
 *   campaigns: { active, paused, draft, lifetime_impressions, lifetime_clicks, lifetime_spent_pence }
 *   users:     { total, premium, banned, new_30d }
 *   ads:       { impressions_7d, clicks_7d, saves_7d }
 */

import { getUserFromRequest } from '../lib/auth.js'
import { queryOne } from '../lib/db.js'
import { withCors, ALLOWED_ORIGINS } from '../lib/cors.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

const NOT_FOUND = (res) => res.status(404).json({ error: 'Not found' })

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

async function handler(req, res) {
  const ipKey = clientIp(req)
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, `admin-dash-ip:${ipKey}`)
  if (rateLimitError) return NOT_FOUND(res)

  if (!isOriginAllowed(req)) return NOT_FOUND(res)

  const user = await getUserFromRequest(req)
  if (!user || !user.is_admin) return NOT_FOUND(res)

  if (req.method !== 'GET') return NOT_FOUND(res)

  // Fire every count in parallel so the dashboard loads in one round-
  // trip's worth of latency rather than N. Individual failures fall
  // back to 0 / null so a single bad query doesn't blank the page.
  const [
    reportsOpen,
    reportsCriticalOpen,
    reportsHighOpen,
    reportsActioned30d,
    campaignsActive,
    campaignsPaused,
    campaignsDraft,
    campaignsLifetime,
    usersTotal,
    usersPremium,
    usersBanned,
    usersNew30d,
    ads7d,
  ] = await Promise.all([
    queryOne(`SELECT COUNT(*) AS n FROM content_reports WHERE status = 'open'`).catch(() => null),
    queryOne(`SELECT COUNT(*) AS n FROM content_reports WHERE status = 'open' AND ai_severity = 'critical'`).catch(() => null),
    queryOne(`SELECT COUNT(*) AS n FROM content_reports WHERE status = 'open' AND ai_severity = 'high'`).catch(() => null),
    queryOne(`SELECT COUNT(*) AS n FROM content_reports WHERE status = 'actioned' AND reviewed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`).catch(() => null),
    queryOne(`SELECT COUNT(*) AS n FROM sponsored_places WHERE status = 'active'`).catch(() => null),
    queryOne(`SELECT COUNT(*) AS n FROM sponsored_places WHERE status = 'paused'`).catch(() => null),
    queryOne(`SELECT COUNT(*) AS n FROM sponsored_places WHERE status = 'draft'`).catch(() => null),
    queryOne(
      `SELECT
         COALESCE(SUM(budget_spent_pence), 0) AS spent_pence,
         (SELECT COUNT(*) FROM ad_impressions) AS impressions,
         (SELECT COUNT(*) FROM ad_impressions WHERE clicked = TRUE) AS clicks
       FROM sponsored_places`
    ).catch(() => null),
    queryOne(`SELECT COUNT(*) AS n FROM users WHERE is_banned = FALSE OR is_banned IS NULL`).catch(() => null),
    queryOne(`SELECT COUNT(*) AS n FROM users WHERE tier = 'premium' AND (subscription_expires_at IS NULL OR subscription_expires_at > NOW())`).catch(() => null),
    queryOne(`SELECT COUNT(*) AS n FROM users WHERE is_banned = TRUE`).catch(() => null),
    queryOne(`SELECT COUNT(*) AS n FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`).catch(() => null),
    queryOne(
      `SELECT
         COUNT(*) AS impressions,
         SUM(CASE WHEN clicked = TRUE THEN 1 ELSE 0 END) AS clicks,
         SUM(CASE WHEN saved = TRUE THEN 1 ELSE 0 END) AS saves
       FROM ad_impressions
       WHERE impressed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
    ).catch(() => null),
  ])

  return res.status(200).json({
    reports: {
      open: reportsOpen?.n ?? 0,
      critical_open: reportsCriticalOpen?.n ?? 0,
      high_open: reportsHighOpen?.n ?? 0,
      actioned_30d: reportsActioned30d?.n ?? 0,
    },
    campaigns: {
      active: campaignsActive?.n ?? 0,
      paused: campaignsPaused?.n ?? 0,
      draft: campaignsDraft?.n ?? 0,
      lifetime_impressions: campaignsLifetime?.impressions ?? 0,
      lifetime_clicks: campaignsLifetime?.clicks ?? 0,
      lifetime_spent_pence: campaignsLifetime?.spent_pence ?? 0,
    },
    users: {
      total: usersTotal?.n ?? 0,
      premium: usersPremium?.n ?? 0,
      banned: usersBanned?.n ?? 0,
      new_30d: usersNew30d?.n ?? 0,
    },
    ads: {
      impressions_7d: ads7d?.impressions ?? 0,
      clicks_7d: ads7d?.clicks ?? 0,
      saves_7d: ads7d?.saves ?? 0,
    },
  })
}

export default withCors(handler)

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
 *   users:     { total, premium, banned, new_7d, new_30d }
 *   activity:  { dau, wau, saves, visits }  (dau/wau from user_stats.last_activity_at)
 *   promoted:  { live }  (paid, active, not moderated out)
 *   ads:       { impressions_7d, clicks_7d, saves_7d }
 */

import { queryOne } from '../lib/db.js'
import { withCors } from '../lib/cors.js'
import { RATE_LIMITS } from '../lib/rateLimit.js'
import { guardAdmin, NOT_FOUND } from '../lib/adminGuard.js'

async function handler(req, res) {
  if (!(await guardAdmin(req, res, { key: 'admin-dash-ip', limit: RATE_LIMITS.API_GENERAL }))) return

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
    usersRow,
    ads7d,
    auditTotal,
    audit7d,
    activeRow,
    savesRow,
    visitsRow,
    promotedLive,
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
    // One pass over users instead of four COUNT queries.
    queryOne(
      `SELECT
         SUM(CASE WHEN is_banned = TRUE THEN 0 ELSE 1 END) AS total,
         SUM(CASE WHEN tier = 'premium' AND (subscription_expires_at IS NULL OR subscription_expires_at > NOW()) THEN 1 ELSE 0 END) AS premium,
         SUM(CASE WHEN is_banned = TRUE THEN 1 ELSE 0 END) AS banned,
         SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS new_7d,
         SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS new_30d
       FROM users`
    ).catch(() => null),
    queryOne(
      `SELECT
         COUNT(*) AS impressions,
         SUM(CASE WHEN clicked = TRUE THEN 1 ELSE 0 END) AS clicks,
         SUM(CASE WHEN saved = TRUE THEN 1 ELSE 0 END) AS saves
       FROM ad_impressions
       WHERE impressed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
    ).catch(() => null),
    queryOne(`SELECT COUNT(*) AS n FROM admin_actions`).catch(() => null),
    queryOne(`SELECT COUNT(*) AS n FROM admin_actions WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`).catch(() => null),
    queryOne(
      `SELECT
         SUM(CASE WHEN last_activity_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS dau,
         SUM(CASE WHEN last_activity_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS wau
       FROM user_stats`
    ).catch(() => null),
    queryOne(`SELECT COUNT(*) AS n FROM saved_places`).catch(() => null),
    queryOne(`SELECT COUNT(*) AS n FROM visited_places`).catch(() => null),
    queryOne(`SELECT COUNT(*) AS n FROM promoted_events WHERE status = 'active' AND payment_status = 'paid' AND moderation_status = 'live'`).catch(() => null),
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
      total: Number(usersRow?.total ?? 0),
      premium: Number(usersRow?.premium ?? 0),
      banned: Number(usersRow?.banned ?? 0),
      new_7d: Number(usersRow?.new_7d ?? 0),
      new_30d: Number(usersRow?.new_30d ?? 0),
    },
    activity: {
      dau: Number(activeRow?.dau ?? 0),
      wau: Number(activeRow?.wau ?? 0),
      saves: savesRow?.n ?? 0,
      visits: visitsRow?.n ?? 0,
    },
    promoted: {
      live: promotedLive?.n ?? 0,
    },
    ads: {
      impressions_7d: ads7d?.impressions ?? 0,
      clicks_7d: ads7d?.clicks ?? 0,
      saves_7d: ads7d?.saves ?? 0,
    },
    audit: {
      actions_total: auditTotal?.n ?? 0,
      actions_7d: audit7d?.n ?? 0,
    },
  })
}

export default withCors(handler)

/**
 * GET /api/admin/ads?range=24h|7d|30d|all
 *
 * Aggregate analytics for sponsored-place impressions. Joins
 * ad_impressions × sponsored_places × business_profiles to surface
 * per-campaign performance, the daily impression series, and the
 * most-recent impression events.
 *
 * All columns referenced here have been confirmed against the live
 * schema via mcp__mysql-roam describe_table (see project's MEMORY:
 * feedback-verify-schema-first). Schema reference:
 *   ad_impressions:  id, sponsored_place_id, user_id, session_id,
 *                    impressed_at, clicked, clicked_at, saved,
 *                    user_lat, user_lng
 *   sponsored_places: id, place_id, business_id, place_data,
 *                     campaign_name, budget_total_pence,
 *                     budget_spent_pence, cpm_pence, status, ...
 *   business_profiles: id, business_name, business_email, ...
 *
 * Security posture mirrors /api/admin/reports — 404 on all reject
 * paths, IP rate limit before auth, Origin/Referer gate, is_admin
 * enforcement.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { withCors, ALLOWED_ORIGINS } from '../lib/cors.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

const VALID_RANGES = { '24h': '1 DAY', '7d': '7 DAY', '30d': '30 DAY', 'all': null }

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
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, `admin-ads-ip:${ipKey}`)
  if (rateLimitError) return NOT_FOUND(res)

  if (!isOriginAllowed(req)) return NOT_FOUND(res)

  const user = await getUserFromRequest(req)
  if (!user || !user.is_admin) return NOT_FOUND(res)

  if (req.method !== 'GET') return NOT_FOUND(res)

  const rangeKey = Object.prototype.hasOwnProperty.call(VALID_RANGES, req.query.range)
    ? req.query.range
    : '7d'
  const interval = VALID_RANGES[rangeKey]
  // Build a single WHERE clause we can reuse across queries. When
  // rangeKey === 'all' we want no time filter, so the clause is empty.
  const whereTime = interval ? `WHERE ai.impressed_at >= DATE_SUB(NOW(), INTERVAL ${interval})` : ''

  // Summary — totals + unique users in range.
  // COALESCE(user_id, session_id) treats anonymous sessions as their
  // own unique participant, so we don't lump every unauthenticated
  // user into one "NULL" bucket.
  const [summaryRow] = await query(
    `SELECT
       COUNT(*) AS impressions,
       SUM(CASE WHEN ai.clicked = 1 THEN 1 ELSE 0 END) AS clicks,
       SUM(CASE WHEN ai.saved = 1 THEN 1 ELSE 0 END) AS saves,
       COUNT(DISTINCT COALESCE(CAST(ai.user_id AS CHAR), ai.session_id)) AS unique_users,
       COUNT(DISTINCT ai.session_id) AS unique_sessions
     FROM ad_impressions ai
     ${whereTime}`
  )

  // Per-campaign breakdown
  const byCampaign = await query(
    `SELECT
       sp.id AS sponsored_place_id,
       sp.campaign_name,
       sp.place_id,
       sp.place_data->>'$.name' AS place_name,
       bp.business_name,
       COUNT(*) AS impressions,
       SUM(CASE WHEN ai.clicked = 1 THEN 1 ELSE 0 END) AS clicks,
       SUM(CASE WHEN ai.saved = 1 THEN 1 ELSE 0 END) AS saves
     FROM ad_impressions ai
     JOIN sponsored_places sp ON sp.id = ai.sponsored_place_id
     LEFT JOIN business_profiles bp ON bp.id = sp.business_id
     ${whereTime}
     GROUP BY sp.id, sp.campaign_name, sp.place_id, place_name, bp.business_name
     ORDER BY impressions DESC
     LIMIT 50`
  )

  // Daily timeseries (DATE() truncates to day, GROUP BY date, ordered ascending)
  const dailySeries = await query(
    `SELECT
       DATE(ai.impressed_at) AS date,
       COUNT(*) AS impressions,
       SUM(CASE WHEN ai.clicked = 1 THEN 1 ELSE 0 END) AS clicks
     FROM ad_impressions ai
     ${whereTime}
     GROUP BY DATE(ai.impressed_at)
     ORDER BY date ASC`
  )

  // Recent events
  const recentEvents = await query(
    `SELECT
       ai.id,
       ai.sponsored_place_id,
       ai.user_id,
       ai.session_id,
       ai.impressed_at,
       ai.clicked,
       ai.clicked_at,
       ai.saved,
       sp.campaign_name,
       sp.place_data->>'$.name' AS place_name,
       bp.business_name
     FROM ad_impressions ai
     JOIN sponsored_places sp ON sp.id = ai.sponsored_place_id
     LEFT JOIN business_profiles bp ON bp.id = sp.business_id
     ${whereTime}
     ORDER BY ai.impressed_at DESC
     LIMIT 20`
  )

  const impressions = Number(summaryRow?.impressions ?? 0)
  const clicks = Number(summaryRow?.clicks ?? 0)
  const saves = Number(summaryRow?.saves ?? 0)
  const ctr = impressions > 0 ? clicks / impressions : 0
  const cvr = clicks > 0 ? saves / clicks : 0

  return res.status(200).json({
    range: rangeKey,
    summary: {
      impressions,
      clicks,
      saves,
      ctr,
      cvr,
      unique_users: Number(summaryRow?.unique_users ?? 0),
      unique_sessions: Number(summaryRow?.unique_sessions ?? 0),
    },
    by_campaign: byCampaign.map(r => ({
      sponsored_place_id: r.sponsored_place_id,
      campaign_name: r.campaign_name,
      place_id: r.place_id,
      place_name: r.place_name,
      business_name: r.business_name,
      impressions: Number(r.impressions),
      clicks: Number(r.clicks),
      saves: Number(r.saves),
      ctr: Number(r.impressions) > 0 ? Number(r.clicks) / Number(r.impressions) : 0,
    })),
    daily_series: dailySeries.map(r => ({
      date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
      impressions: Number(r.impressions),
      clicks: Number(r.clicks),
    })),
    recent_events: recentEvents.map(r => ({
      id: r.id,
      sponsored_place_id: r.sponsored_place_id,
      user_id: r.user_id,
      session_id: r.session_id,
      impressed_at: r.impressed_at,
      clicked: !!r.clicked,
      clicked_at: r.clicked_at,
      saved: !!r.saved,
      campaign_name: r.campaign_name,
      place_name: r.place_name,
      business_name: r.business_name,
    })),
  })
}

export default withCors(handler)

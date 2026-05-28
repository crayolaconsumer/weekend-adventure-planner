/**
 * /api/admin/reports
 *
 * Admin queue for content reports. Designed to be effectively invisible
 * to non-admins: every reject path returns 404 with the same body, the
 * lazy-loaded admin chunk never ships for non-admin sessions (route
 * guard at the App.jsx level), and the URL changes when a non-admin
 * tries to navigate here so the page looks identical to any other 404.
 *
 * Threat model & mitigations
 *   T1  Route discovery       → 404 (not 401/403) for non-admins, no
 *                                error-shape differences
 *   T2  Rate-window probing   → IP-keyed rate limit runs BEFORE auth so
 *                                anonymous attackers can't burn quota
 *   T3  CSRF / cross-origin   → Origin/Referer must be in our allowlist
 *                                AND withCors restricts CORS responses
 *   T4  Privilege escalation  → can't ban admins, can't ban self, can't
 *                                act on the report you filed
 *   T5  Compromised admin JWT → fresh-login required (≤30 min) for any
 *                                destructive action (hide_content,
 *                                ban_user). Mirrors delete-account.
 *   T6  Forensics             → every admin action recorded in
 *                                admin_actions table with IP + UA
 *
 * Methods
 *   GET  → paginated queue, filterable by status + severity
 *   POST → record a decision (dismiss/review/action) + optional cascade
 *           (hide_content | ban_user | none)
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, update, insert } from '../lib/db.js'
import { withCors, ALLOWED_ORIGINS } from '../lib/cors.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

const VALID_STATUSES = new Set(['open', 'reviewed', 'dismissed', 'actioned'])
const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low'])
const VALID_DECISIONS = new Set(['dismiss', 'review', 'action'])
const VALID_ACTIONS = new Set(['hide_content', 'hide_review', 'ban_user', 'none'])

// Uniform "this route does not exist" response. Used for EVERY reject
// path — anonymous, non-admin, banned admin, bad origin, rate-limited.
// The body shape is intentionally identical to a Vercel-default 404.
const NOT_FOUND = (res) => res.status(404).json({ error: 'Not found' })

// Pull a stable client IP. Vercel sets x-forwarded-for; first hop is
// the real client. Fall back to socket address for local dev.
function clientIp(req) {
  const fwd = req.headers?.['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim()
  return req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown'
}

function isOriginAllowed(req) {
  // Browser-issued requests carry Origin; native (Capacitor) and same-
  // origin server fetches may set Referer instead. Treat both as
  // assertions about where the request came from. No header at all =
  // unknown caller = reject.
  const origin = req.headers?.origin
  const referer = req.headers?.referer
  const candidate = origin || referer
  if (!candidate) return false

  for (const allowed of ALLOWED_ORIGINS) {
    if (candidate === allowed || candidate.startsWith(allowed + '/')) return true
  }
  return false
}

async function handler(req, res) {
  // IP-keyed rate limit BEFORE auth — stops anonymous attackers from
  // burning admin endpoint compute looking for timing oracles or
  // probing for route existence.
  const ipKey = clientIp(req)
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, `admin-ip:${ipKey}`)
  if (rateLimitError) return NOT_FOUND(res)

  // Origin/Referer gate. CSRF defence + extra layer of "this should
  // only ever be called from our own frontend".
  if (!isOriginAllowed(req)) return NOT_FOUND(res)

  // Auth + admin role. Banned admins also fail here because
  // getUserFromRequest returns null when is_banned.
  const user = await getUserFromRequest(req)
  if (!user || !user.is_admin) return NOT_FOUND(res)

  if (req.method === 'GET') return handleList(req, res)
  if (req.method === 'POST') return handleAction(req, res, user, ipKey)
  return NOT_FOUND(res)
}

async function handleList(req, res) {
  const status = req.query.status && VALID_STATUSES.has(req.query.status) ? req.query.status : 'open'
  const severity = req.query.severity && VALID_SEVERITIES.has(req.query.severity) ? req.query.severity : null
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100)
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0)

  const where = ['r.status = ?']
  const params = [status]
  if (severity) {
    where.push('r.ai_severity = ?')
    params.push(severity)
  }
  const whereClause = where.join(' AND ')

  const reports = await query(
    `SELECT
       r.id, r.entity_type, r.entity_id, r.reported_user_id, r.reason, r.details,
       r.status, r.ai_severity, r.ai_reason, r.ai_action_taken, r.ai_triaged_at,
       r.created_at, r.reviewed_at, r.reviewed_by,
       reporter.username AS reporter_username,
       reporter.avatar_url AS reporter_avatar_url,
       reported.username AS reported_username,
       reported.avatar_url AS reported_avatar_url,
       reported.is_admin  AS reported_is_admin,
       reported.is_banned AS reported_is_banned
     FROM content_reports r
     LEFT JOIN users reporter ON r.reporter_id = reporter.id
     LEFT JOIN users reported ON r.reported_user_id = reported.id
     WHERE ${whereClause}
     ORDER BY
       FIELD(r.ai_severity, 'critical', 'high', 'medium', 'low'),
       r.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  // Hydrate the reported content per entity_type. Doing this as separate
  // bulk lookups keeps each query trivially indexable; the old single-
  // query approach with `CAST(entity_id AS UNSIGNED)` silently returned
  // 0 for any non-numeric entity_id (including the legacy "rating_X"
  // prefix from the activity feed) so reviewers never saw the actual
  // reported content.
  const contribIds = []
  const reviewIds = []
  const userIds = []
  const placeIds = new Set()

  for (const r of reports) {
    const isNumericId = /^\d+$/.test(r.entity_id || '')
    if (!isNumericId && r.entity_type !== 'place') continue
    if (r.entity_type === 'contribution' || r.entity_type === 'photo') {
      contribIds.push(parseInt(r.entity_id, 10))
    } else if (r.entity_type === 'review') {
      reviewIds.push(parseInt(r.entity_id, 10))
    } else if (r.entity_type === 'user') {
      userIds.push(parseInt(r.entity_id, 10))
    } else if (r.entity_type === 'place') {
      placeIds.add(r.entity_id)
    }
  }

  const contribs = contribIds.length
    ? await query(
        `SELECT id, content, contribution_type, status, place_id, place_name, place_image_url
           FROM contributions WHERE id IN (?)`,
        [contribIds]
      )
    : []
  const reviews = reviewIds.length
    ? await query(
        `SELECT id, rating, review, place_id FROM place_ratings WHERE id IN (?)`,
        [reviewIds]
      )
    : []
  const reportedUsers = userIds.length
    ? await query(
        `SELECT id, username, display_name, avatar_url, is_banned
           FROM users WHERE id IN (?)`,
        [userIds]
      )
    : []

  // Fold review place IDs into the lookup set so we can name them too.
  for (const rev of reviews) {
    if (rev.place_id) placeIds.add(rev.place_id)
  }

  // place_name isn't stored on place_ratings (only contributions cache
  // it). Pull from whichever user-data table happens to have cached it
  // — saved_places has the broadest coverage. UNION over visited_places
  // catches places only the rater has visited.
  const placeMap = new Map()
  if (placeIds.size > 0) {
    const placeIdArr = Array.from(placeIds)
    const placeRows = await query(
      `SELECT place_id, MIN(name) AS place_name FROM (
         SELECT place_id, place_data->>'$.name' AS name FROM saved_places WHERE place_id IN (?)
         UNION ALL
         SELECT place_id, place_data->>'$.name' AS name FROM visited_places WHERE place_id IN (?)
         UNION ALL
         SELECT place_id, place_data->>'$.name' AS name FROM sponsored_places WHERE place_id IN (?)
       ) AS p
       WHERE name IS NOT NULL AND name <> ''
       GROUP BY place_id`,
      [placeIdArr, placeIdArr, placeIdArr]
    )
    for (const row of placeRows) placeMap.set(row.place_id, row.place_name)
  }

  const contribMap = new Map(contribs.map(c => [c.id, c]))
  const reviewMap = new Map(reviews.map(r => [r.id, r]))
  const userMap = new Map(reportedUsers.map(u => [u.id, u]))

  const hydrated = reports.map(r => {
    const base = {
      ...r,
      reported_content: null,
      reported_content_type: null,
      reported_content_status: null,
      reported_rating: null,
      reported_place_id: null,
      reported_place_name: null,
      reported_place_image_url: null,
    }

    if (r.entity_type === 'contribution' || r.entity_type === 'photo') {
      const c = contribMap.get(parseInt(r.entity_id, 10))
      if (c) {
        base.reported_content = c.content
        base.reported_content_type = c.contribution_type
        base.reported_content_status = c.status
        base.reported_place_id = c.place_id
        base.reported_place_name = c.place_name
        base.reported_place_image_url = c.place_image_url
      }
    } else if (r.entity_type === 'review') {
      const rev = reviewMap.get(parseInt(r.entity_id, 10))
      if (rev) {
        base.reported_content = rev.review
        base.reported_content_type = 'review'
        base.reported_rating = rev.rating
        base.reported_place_id = rev.place_id
        base.reported_place_name = placeMap.get(rev.place_id) || null
      }
    } else if (r.entity_type === 'user') {
      const u = userMap.get(parseInt(r.entity_id, 10))
      if (u) {
        base.reported_username = base.reported_username || u.username
        base.reported_avatar_url = base.reported_avatar_url || u.avatar_url
      }
    } else if (r.entity_type === 'place') {
      base.reported_place_id = r.entity_id
      base.reported_place_name = placeMap.get(r.entity_id) || null
    }

    return base
  })

  const totalRow = await queryOne(
    `SELECT COUNT(*) AS total FROM content_reports r WHERE ${whereClause}`,
    params
  )
  const total = totalRow?.total ?? 0

  return res.status(200).json({
    reports: hydrated,
    total,
    hasMore: offset + hydrated.length < total,
    limit,
    offset,
  })
}

async function handleAction(req, res, user, ipKey) {
  const { reportId, decision, actionTaken = 'none' } = req.body || {}

  if (!Number.isInteger(reportId) || reportId <= 0) return NOT_FOUND(res)
  if (!VALID_DECISIONS.has(decision)) return NOT_FOUND(res)
  if (!VALID_ACTIONS.has(actionTaken)) return NOT_FOUND(res)

  const report = await queryOne(
    'SELECT id, entity_type, entity_id, reporter_id, reported_user_id FROM content_reports WHERE id = ?',
    [reportId]
  )
  if (!report) return NOT_FOUND(res)

  // Refuse to let an admin action a report they themselves filed —
  // separation of duties.
  if (report.reporter_id && report.reporter_id === user.id) {
    return res.status(403).json({ error: 'You cannot action your own report. Ask another admin.' })
  }

  // Destructive actions require a fresh login. Mirrors the delete-
  // account flow; cuts the window during which a stolen admin JWT can
  // do real damage.
  if (actionTaken === 'hide_content' || actionTaken === 'ban_user') {
    const fresh = await queryOne('SELECT last_login_at FROM users WHERE id = ?', [user.id])
    const loginAge = fresh?.last_login_at
      ? (Date.now() - new Date(fresh.last_login_at).getTime()) / 60000
      : Infinity
    if (loginAge > 30) {
      return res.status(401).json({
        error: 'Please sign in again before taking this action',
        code: 'STALE_SESSION',
      })
    }
  }

  const newStatus =
    decision === 'dismiss' ? 'dismissed' :
    decision === 'action' ? 'actioned' :
    'reviewed'

  if (actionTaken === 'hide_content') {
    if (report.entity_type !== 'contribution' && report.entity_type !== 'photo') {
      return res.status(400).json({ error: 'hide_content only valid for contribution/photo reports' })
    }
    await update(
      `UPDATE contributions SET status = 'rejected' WHERE id = ?`,
      [report.entity_id]
    )
  } else if (actionTaken === 'hide_review') {
    if (report.entity_type !== 'review') {
      return res.status(400).json({ error: 'hide_review only valid for review reports' })
    }
    // Null the review text but keep the rating score — the user's
    // average rating still counts, only the offensive freeform text
    // is removed. updated_at bumps so any cache layers refresh.
    await update(
      `UPDATE place_ratings SET review = NULL, updated_at = NOW() WHERE id = ?`,
      [report.entity_id]
    )
  } else if (actionTaken === 'ban_user') {
    if (!report.reported_user_id) {
      return res.status(400).json({ error: 'No reported user to ban' })
    }
    if (report.reported_user_id === user.id) {
      return res.status(400).json({ error: 'You cannot ban yourself.' })
    }
    // Don't let an admin ban another admin — accidental or hostile
    // takeover prevention. Demotion has to happen via direct SQL.
    const target = await queryOne(
      'SELECT id, is_admin FROM users WHERE id = ?',
      [report.reported_user_id]
    )
    if (!target) return res.status(404).json({ error: 'Target user not found' })
    if (target.is_admin) {
      return res.status(403).json({ error: 'Cannot ban another admin. Demote first via SQL.' })
    }
    await update(
      `UPDATE users SET is_banned = TRUE WHERE id = ?`,
      [report.reported_user_id]
    )
  }

  await update(
    `UPDATE content_reports
        SET status = ?, ai_action_taken = ?, reviewed_at = NOW(), reviewed_by = ?
      WHERE id = ?`,
    [newStatus, actionTaken === 'none' ? null : actionTaken, user.id, reportId]
  )

  // Append-only audit log. Captures the actor, target, action, and
  // request fingerprint for forensics.
  try {
    await insert(
      `INSERT INTO admin_actions
        (admin_id, action, target_type, target_id, report_id, ip, user_agent, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        `report.${decision}${actionTaken !== 'none' ? `.${actionTaken}` : ''}`,
        report.entity_type,
        String(report.entity_id),
        reportId,
        ipKey,
        (req.headers?.['user-agent'] || '').slice(0, 500),
        JSON.stringify({ reportedUserId: report.reported_user_id }),
      ]
    )
  } catch (err) {
    // Audit failure should NOT block the operation, but it MUST be
    // visible — log loudly. Operator can reconcile via content_reports
    // reviewed_by/reviewed_at if audit is ever lost.
    console.error('admin audit log failed:', err)
  }

  return res.status(200).json({ success: true, status: newStatus, actionTaken })
}

export default withCors(handler)

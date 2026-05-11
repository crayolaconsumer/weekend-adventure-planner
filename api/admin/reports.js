/**
 * /api/admin/reports
 *
 * Admin queue for content reports. Gated on `users.is_admin = TRUE` —
 * any non-admin caller (including unauthenticated requests) receives
 * 403/401 with no body distinction so we don't reveal the route's
 * existence by error-shape probing.
 *
 * Methods
 *   GET  /api/admin/reports
 *     Query: ?status=open|reviewed|dismissed|actioned (default: open)
 *            ?severity=critical|high|medium|low (filter)
 *            ?limit=20 (max 100)
 *            ?offset=0
 *     Returns: { reports: [...], total, hasMore }
 *
 *   POST /api/admin/reports
 *     Body: { reportId, decision: 'dismiss'|'review'|'action',
 *             actionTaken?: 'hide_content'|'ban_user'|'none' }
 *     - Updates content_reports.status + reviewed_at + reviewed_by
 *     - Optional actionTaken cascades:
 *         hide_content → contributions.status='rejected' (only for
 *                        entity_type in {contribution, photo})
 *         ban_user     → users.is_banned=TRUE on the reported user
 *                        (column auto-created on first ban — see below)
 *
 * Security notes
 *   - JWT auth (same as the rest of the app)
 *   - Admin check fires BEFORE rate-limit so non-admins can't probe
 *     for the route by exhausting the rate window
 *   - CORS via withCors() — only same-origin + go-roam.uk
 *   - Audit trail: reviewed_by + reviewed_at populated on every decision
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, update } from '../lib/db.js'
import { withCors } from '../lib/cors.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

const VALID_STATUSES = new Set(['open', 'reviewed', 'dismissed', 'actioned'])
const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low'])
const VALID_DECISIONS = new Set(['dismiss', 'review', 'action'])
const VALID_ACTIONS = new Set(['hide_content', 'ban_user', 'none'])

async function handler(req, res) {
  // Auth gate first — must happen before rate limit, otherwise non-admins
  // can detect the endpoint by triggering a 429 with no auth.
  const user = await getUserFromRequest(req)
  if (!user) return res.status(401).json({ error: 'Not authenticated' })
  if (!user.is_admin) return res.status(403).json({ error: 'Forbidden' })

  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, `admin:${user.id}`)
  if (rateLimitError) return res.status(rateLimitError.status).json(rateLimitError)

  if (req.method === 'GET') return handleList(req, res)
  if (req.method === 'POST') return handleAction(req, res, user)
  return res.status(405).json({ error: 'Method not allowed' })
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

  // ai_severity is treated as critical>high>medium>low for ordering. We
  // hand FIELD() an explicit list rather than ENUM ordering so the
  // semantics are obvious in code review.
  const reports = await query(
    `SELECT
       r.id, r.entity_type, r.entity_id, r.reported_user_id, r.reason, r.details,
       r.status, r.ai_severity, r.ai_reason, r.ai_action_taken, r.ai_triaged_at,
       r.created_at, r.reviewed_at, r.reviewed_by,
       reporter.username AS reporter_username,
       reported.username AS reported_username,
       c.content AS content_text,
       c.contribution_type AS content_type,
       c.status AS content_status
     FROM content_reports r
     LEFT JOIN users reporter ON r.reporter_id = reporter.id
     LEFT JOIN users reported ON r.reported_user_id = reported.id
     LEFT JOIN contributions c ON r.entity_type IN ('contribution','photo') AND c.id = CAST(r.entity_id AS UNSIGNED)
     WHERE ${whereClause}
     ORDER BY
       FIELD(r.ai_severity, 'critical', 'high', 'medium', 'low'),
       r.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  const totalRow = await queryOne(
    `SELECT COUNT(*) AS total FROM content_reports r WHERE ${whereClause}`,
    params
  )
  const total = totalRow?.total ?? 0

  return res.status(200).json({
    reports,
    total,
    hasMore: offset + reports.length < total,
    limit,
    offset,
  })
}

async function handleAction(req, res, user) {
  const { reportId, decision, actionTaken = 'none' } = req.body || {}

  if (!Number.isInteger(reportId) || reportId <= 0) {
    return res.status(400).json({ error: 'Invalid reportId' })
  }
  if (!VALID_DECISIONS.has(decision)) {
    return res.status(400).json({ error: 'Invalid decision' })
  }
  if (!VALID_ACTIONS.has(actionTaken)) {
    return res.status(400).json({ error: 'Invalid actionTaken' })
  }

  const report = await queryOne(
    'SELECT id, entity_type, entity_id, reported_user_id FROM content_reports WHERE id = ?',
    [reportId]
  )
  if (!report) return res.status(404).json({ error: 'Report not found' })

  // Map decision → final status. 'review' just stamps it as triaged
  // without prescribing an outcome (use when you want a record of "I
  // looked, no decision yet").
  const newStatus =
    decision === 'dismiss' ? 'dismissed' :
    decision === 'action' ? 'actioned' :
    'reviewed'

  // Apply cascading effect on entity.
  if (actionTaken === 'hide_content') {
    if (report.entity_type !== 'contribution' && report.entity_type !== 'photo') {
      return res.status(400).json({ error: 'hide_content only valid for contribution/photo reports' })
    }
    await update(
      `UPDATE contributions SET status = 'rejected' WHERE id = ?`,
      [report.entity_id]
    )
  } else if (actionTaken === 'ban_user') {
    if (!report.reported_user_id) {
      return res.status(400).json({ error: 'No reported user to ban' })
    }
    // Lazy-create the is_banned column on first ban — keeps the
    // migration cost zero until you actually need it. ALTER IF NOT
    // EXISTS isn't standard MySQL, so swallow the "duplicate column"
    // error if the column already exists.
    try {
      await update(`ALTER TABLE users ADD COLUMN is_banned BOOLEAN NOT NULL DEFAULT FALSE`)
    } catch (err) {
      if (!String(err?.message || '').includes('Duplicate column')) {
        console.error('is_banned column create failed:', err)
      }
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

  return res.status(200).json({ success: true, status: newStatus, actionTaken })
}

export default withCors(handler)

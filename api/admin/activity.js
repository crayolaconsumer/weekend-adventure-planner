/**
 * GET /api/admin/activity?limit=100&category=all|reports|campaigns|users
 *
 * Chronological audit log of admin actions. Joins admin_actions with
 * users so we can surface the acting admin's username (not just their
 * numeric id). Used by:
 *   - /admin/activity (the audit page)
 *   - The "Recently" footer block on /admin (calls with limit=3 or 5)
 *
 * Schema (all columns verified via mcp__mysql-roam describe_table —
 * see project's MEMORY: feedback-verify-schema-first):
 *   admin_actions: id, admin_id, action, target_type, target_id,
 *                  report_id, ip, user_agent, metadata, created_at
 *   users:         id, username, ...
 *
 * Security posture mirrors /api/admin/reports.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne } from '../lib/db.js'
import { withCors, ALLOWED_ORIGINS } from '../lib/cors.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

const VALID_CATEGORIES = new Set(['all', 'reports', 'campaigns', 'users'])

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
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, `admin-activity-ip:${ipKey}`)
  if (rateLimitError) return NOT_FOUND(res)

  if (!isOriginAllowed(req)) return NOT_FOUND(res)

  const user = await getUserFromRequest(req)
  if (!user || !user.is_admin) return NOT_FOUND(res)

  if (req.method !== 'GET') return NOT_FOUND(res)

  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500)
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0)
  const category = VALID_CATEGORIES.has(req.query.category) ? req.query.category : 'all'

  // Action strings follow the convention `<category>.<verb>[.<subaction>]`
  // — e.g. report.dismiss, report.action.hide_review, campaign.create.active,
  // user.ban. Filter via prefix match so we don't need an explicit
  // category column.
  const where = []
  const params = []

  if (category === 'reports') {
    where.push("a.action LIKE 'report.%'")
  } else if (category === 'campaigns') {
    where.push("a.action LIKE 'campaign.%'")
  } else if (category === 'users') {
    where.push("a.action LIKE 'user.%'")
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = await query(
    `SELECT
       a.id, a.admin_id, a.action, a.target_type, a.target_id,
       a.report_id, a.ip, a.metadata, a.created_at,
       u.username AS admin_username,
       u.avatar_url AS admin_avatar_url
     FROM admin_actions a
     LEFT JOIN users u ON u.id = a.admin_id
     ${whereClause}
     ORDER BY a.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  const totalRow = await queryOne(
    `SELECT COUNT(*) AS total FROM admin_actions a ${whereClause}`,
    params
  )

  const total = totalRow?.total ?? 0

  return res.status(200).json({
    actions: rows.map(r => ({
      ...r,
      // Parse metadata to JSON for the client. Stored as JSON column so
      // mysql2 returns it as either an object (newer drivers) or string.
      metadata: typeof r.metadata === 'string'
        ? safeParse(r.metadata)
        : r.metadata,
    })),
    total,
    hasMore: offset + rows.length < total,
    category,
    limit,
    offset,
  })
}

function safeParse(s) {
  try { return JSON.parse(s) } catch { return null }
}

export default withCors(handler)

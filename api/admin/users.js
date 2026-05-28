/**
 * /api/admin/users
 *
 * Operator browse/manage for the user table. Mirrors the security
 * posture of /api/admin/reports — 404 on every reject path, IP rate
 * limit before auth, Origin/Referer gate, is_admin enforcement,
 * fresh-login required for ban/unban, append-only audit log.
 *
 * Methods
 *   GET   → filterable + searchable list with engagement stats
 *           ?filter=all|premium|new|banned|inactive
 *           ?search=<username or email substring>
 *           ?limit=50&offset=0
 *   PATCH → toggle is_banned (cannot ban self, cannot ban an admin)
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, update, insert } from '../lib/db.js'
import { withCors, ALLOWED_ORIGINS } from '../lib/cors.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

const VALID_FILTERS = new Set(['all', 'premium', 'new', 'banned', 'inactive'])

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

async function requireFreshLogin(userId) {
  const fresh = await queryOne('SELECT last_login_at FROM users WHERE id = ?', [userId])
  const ageMin = fresh?.last_login_at
    ? (Date.now() - new Date(fresh.last_login_at).getTime()) / 60000
    : Infinity
  return ageMin <= 30
}

async function handler(req, res) {
  const ipKey = clientIp(req)
  const limit = req.method === 'GET' ? RATE_LIMITS.API_GENERAL : RATE_LIMITS.API_WRITE
  const rateLimitError = applyRateLimit(req, res, limit, `admin-users-ip:${ipKey}`)
  if (rateLimitError) return NOT_FOUND(res)

  if (!isOriginAllowed(req)) return NOT_FOUND(res)

  const user = await getUserFromRequest(req)
  if (!user || !user.is_admin) return NOT_FOUND(res)

  if (req.method === 'GET') return handleList(req, res)
  if (req.method === 'PATCH') return handleBanToggle(req, res, user, ipKey)
  return NOT_FOUND(res)
}

async function handleList(req, res) {
  const filter = VALID_FILTERS.has(req.query.filter) ? req.query.filter : 'all'
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : ''
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200)
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0)

  const where = []
  const params = []

  if (filter === 'premium') {
    where.push("u.tier = 'premium' AND (u.subscription_expires_at IS NULL OR u.subscription_expires_at > NOW())")
  } else if (filter === 'new') {
    where.push('u.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)')
  } else if (filter === 'banned') {
    where.push('u.is_banned = TRUE')
  } else if (filter === 'inactive') {
    where.push('(u.last_login_at IS NULL OR u.last_login_at < DATE_SUB(NOW(), INTERVAL 30 DAY))')
  }

  if (search.length > 0) {
    // Escape LIKE meta-characters (%, _, \) in the user input so a
    // search for "10%" doesn't act as a wildcard and return everything.
    // Parameterization protects against SQL injection; this escape is
    // for correctness of the LIKE semantics.
    const escaped = search.replace(/[\\%_]/g, '\\$&')
    where.push("(LOWER(u.username) LIKE LOWER(?) ESCAPE '\\\\' OR LOWER(u.email) LIKE LOWER(?) ESCAPE '\\\\')")
    const like = `%${escaped}%`
    params.push(like, like)
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  // All columns referenced here are confirmed via mcp__mysql-roam describe_table
  // — see project's MEMORY: feedback-verify-schema-first.
  const rows = await query(
    `SELECT
       u.id, u.email, u.username, u.display_name, u.avatar_url,
       u.tier, u.is_admin, u.is_banned,
       u.subscription_expires_at, u.subscription_source, u.subscription_cancelled_at,
       u.created_at, u.last_login_at,
       s.total_swipes, s.places_saved, s.places_visited,
       s.current_streak, s.best_streak, s.last_activity_at
     FROM users u
     LEFT JOIN user_stats s ON s.user_id = u.id
     ${whereClause}
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  const totalRow = await queryOne(
    `SELECT COUNT(*) AS total FROM users u ${whereClause}`,
    params
  )
  const total = totalRow?.total ?? 0

  return res.status(200).json({
    users: rows,
    total,
    hasMore: offset + rows.length < total,
    limit,
    offset,
    filter,
    search,
  })
}

async function handleBanToggle(req, res, admin, ipKey) {
  if (!(await requireFreshLogin(admin.id))) {
    return res.status(401).json({ error: 'Please sign in again', code: 'STALE_SESSION' })
  }

  const { id, is_banned } = req.body || {}
  if (!Number.isInteger(id) || id <= 0) return NOT_FOUND(res)
  if (typeof is_banned !== 'boolean') {
    return res.status(400).json({ error: 'is_banned must be true or false' })
  }

  if (id === admin.id) {
    return res.status(400).json({ error: 'You cannot ban or unban yourself.' })
  }

  const target = await queryOne(
    'SELECT id, username, is_admin, is_banned FROM users WHERE id = ?',
    [id]
  )
  if (!target) return NOT_FOUND(res)

  if (target.is_admin) {
    return res.status(403).json({ error: 'Cannot ban another admin. Demote first via SQL.' })
  }

  await update(
    'UPDATE users SET is_banned = ? WHERE id = ?',
    [is_banned ? 1 : 0, id]
  )

  try {
    await insert(
      `INSERT INTO admin_actions
         (admin_id, action, target_type, target_id, ip, user_agent, metadata)
       VALUES (?, ?, 'user', ?, ?, ?, ?)`,
      [
        admin.id,
        is_banned ? 'user.ban' : 'user.unban',
        String(id),
        ipKey,
        (req.headers?.['user-agent'] || '').slice(0, 500),
        JSON.stringify({ username: target.username, previous_is_banned: !!target.is_banned }),
      ]
    )
  } catch (err) {
    console.error('admin audit log failed (user ban):', err)
  }

  return res.status(200).json({ success: true, id, is_banned })
}

export default withCors(handler)

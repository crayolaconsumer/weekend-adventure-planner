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
 *           ?filter=all|premium|new|banned|inactive|test
 *           ?search=<username or email substring>
 *           ?limit=50&offset=0
 *   PATCH → toggle is_banned (cannot ban self, cannot ban an admin)
 *   DELETE → hard-delete an account { id, confirm } where confirm is the
 *            target's username (or email when it has none). Fresh login,
 *            not self, not an admin. Audited as 'user.delete'.
 */

import { query, queryOne, update, insert } from '../lib/db.js'
import { withCors } from '../lib/cors.js'
import { RATE_LIMITS } from '../lib/rateLimit.js'
import { guardAdmin, NOT_FOUND, requireFreshLogin } from '../lib/adminGuard.js'
import { deleteUserAccount } from '../lib/accounts.js'

const VALID_FILTERS = new Set(['all', 'premium', 'new', 'banned', 'inactive', 'test'])

// 'Likely test accounts': a throwaway-looking email/username (covers
// +test, @roam.test, mailinator, example.com), or a signup older than a
// week that never swiped, saved or visited anything. A review list, not
// an auto-delete: every delete still needs the typed confirmation.
export const TEST_ACCOUNT_SQL = `(
  LOWER(u.email) REGEXP 'test|demo|example|mailinator'
  OR LOWER(COALESCE(u.username, '')) REGEXP 'test|demo|example'
  OR (u.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
      AND COALESCE(s.total_swipes, 0) = 0
      AND COALESCE(s.places_saved, 0) = 0
      AND COALESCE(s.places_visited, 0) = 0)
)`

async function handler(req, res) {
  const gate = await guardAdmin(req, res, { key: 'admin-users-ip', limit: req.method === 'GET' ? RATE_LIMITS.API_GENERAL : RATE_LIMITS.API_WRITE })
  if (!gate) return
  const { user, ip: ipKey } = gate

  if (req.method === 'GET') return handleList(req, res)
  if (req.method === 'PATCH') return handleBanToggle(req, res, user, ipKey)
  if (req.method === 'DELETE') return handleDelete(req, res, user, ipKey)
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
  } else if (filter === 'test') {
    where.push(TEST_ACCOUNT_SQL)
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
    `SELECT COUNT(*) AS total FROM users u LEFT JOIN user_stats s ON s.user_id = u.id ${whereClause}`,
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

async function handleDelete(req, res, admin, ipKey) {
  if (!(await requireFreshLogin(admin.id))) {
    return res.status(401).json({ error: 'Please sign in again', code: 'STALE_SESSION' })
  }

  const { id, confirm } = req.body || {}
  if (!Number.isInteger(id) || id <= 0) return NOT_FOUND(res)
  if (id === admin.id) {
    return res.status(400).json({ error: 'You cannot delete your own account from here.' })
  }

  const target = await queryOne('SELECT id, username, email, is_admin FROM users WHERE id = ?', [id])
  if (!target) return NOT_FOUND(res)
  if (target.is_admin) {
    return res.status(403).json({ error: 'Cannot delete an admin. Demote first via SQL.' })
  }
  if (typeof confirm !== 'string' || confirm !== (target.username || target.email)) {
    return res.status(400).json({ error: 'Type the username to confirm.' })
  }

  try {
    await deleteUserAccount(id)
  } catch (err) {
    console.error('admin user delete failed:', err)
    return res.status(500).json({ error: 'Delete failed' })
  }

  try {
    await insert(
      `INSERT INTO admin_actions
         (admin_id, action, target_type, target_id, ip, user_agent, metadata)
       VALUES (?, ?, 'user', ?, ?, ?, ?)`,
      [
        admin.id,
        'user.delete',
        String(id),
        ipKey,
        (req.headers?.['user-agent'] || '').slice(0, 500),
        JSON.stringify({ username: target.username, email_domain: String(target.email || '').split('@')[1] || null }),
      ]
    )
  } catch (err) {
    console.error('admin audit log failed (user delete):', err)
  }

  return res.status(200).json({ success: true })
}

export default withCors(handler)

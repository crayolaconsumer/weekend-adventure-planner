/**
 * /api/admin/promoted-events
 *
 * Operator moderation for self-serve promoted events. Same security posture as
 * /api/admin/campaigns — 404 on every reject path, IP rate limit before auth,
 * Origin/Referer gate, is_admin enforcement, fresh-login for mutations,
 * append-only audit log.
 *
 * This is the safety net for the auto-publish model: paid events go live
 * immediately, and an operator can pull a bad one here (or via the
 * `promotedEvents` kill-switch for the whole feature).
 *
 * Methods
 *   GET   → list promoted events with partner + rolled-up stats; optional
 *           ?moderation=live|flagged|removed and ?status= filters
 *   PATCH → set moderation_status (live | flagged | removed) for one event
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, update, insert } from '../lib/db.js'
import { withCors, ALLOWED_ORIGINS } from '../lib/cors.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { validateId } from '../lib/validation.js'

const VALID_MODERATION = new Set(['live', 'flagged', 'removed'])
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
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, `admin-pe-ip:${ipKey}`)
  if (rateLimitError) return NOT_FOUND(res)

  if (!isOriginAllowed(req)) return NOT_FOUND(res)

  const user = await getUserFromRequest(req)
  if (!user || !user.is_admin) return NOT_FOUND(res)

  if (req.method === 'GET') return handleList(req, res)
  if (req.method === 'PATCH') return handleModerate(req, res, user, ipKey)
  return NOT_FOUND(res)
}

async function handleList(req, res) {
  const filters = []
  const params = []
  if (req.query.moderation && VALID_MODERATION.has(req.query.moderation)) {
    filters.push('pe.moderation_status = ?')
    params.push(req.query.moderation)
  }
  if (req.query.status) {
    filters.push('pe.status = ?')
    params.push(String(req.query.status))
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''

  const events = await query(
    `SELECT pe.id, pe.title, pe.category, pe.venue_name, pe.address, pe.lat, pe.lng,
            pe.starts_at, pe.ends_at, pe.info_url, pe.image_url, pe.price_info,
            pe.promo_radius_km, pe.promo_starts_on, pe.promo_ends_on,
            pe.price_paid_pence, pe.currency, pe.payment_status,
            pe.moderation_status, pe.status, pe.created_at,
            pa.id AS partner_id, pa.org_name, pa.contact_email,
            COUNT(pei.id) AS impressions,
            SUM(pei.clicked) AS clicks,
            SUM(pei.saved) AS saves
     FROM promoted_events pe
     JOIN partner_accounts pa ON pe.partner_id = pa.id
     LEFT JOIN promoted_event_impressions pei ON pei.promoted_event_id = pe.id
     ${where}
     GROUP BY pe.id
     ORDER BY pe.created_at DESC
     LIMIT 200`,
    params
  )
  return res.status(200).json({ events })
}

async function handleModerate(req, res, user, ipKey) {
  if (!(await requireFreshLogin(user.id))) {
    return res.status(403).json({ error: 'Re-authenticate to moderate', code: 'FRESH_LOGIN_REQUIRED' })
  }

  const idCheck = validateId(req.body?.id)
  if (!idCheck.valid) return res.status(400).json({ error: 'Invalid id' })

  const moderation = req.body?.moderation_status
  if (!VALID_MODERATION.has(moderation)) {
    return res.status(400).json({ error: 'Invalid moderation_status' })
  }

  const event = await queryOne('SELECT id, moderation_status FROM promoted_events WHERE id = ?', [idCheck.id])
  if (!event) return NOT_FOUND(res)

  await update(
    `UPDATE promoted_events SET moderation_status = ? WHERE id = ?`,
    [moderation, idCheck.id]
  )

  await auditLog(
    user.id, 'moderate_promoted_event', 'promoted_event', String(idCheck.id),
    { from: event.moderation_status, to: moderation, reason: req.body?.reason || null },
    ipKey, req.headers?.['user-agent']
  )

  return res.status(200).json({ success: true, id: idCheck.id, moderation_status: moderation })
}

async function auditLog(adminId, action, targetType, targetId, metadata, ip, userAgent) {
  try {
    await insert(
      `INSERT INTO admin_actions
         (admin_id, action, target_type, target_id, ip, user_agent, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [adminId, action, targetType, targetId, ip, (userAgent || '').slice(0, 500),
        metadata ? JSON.stringify(metadata) : null]
    )
  } catch (err) {
    console.error('admin audit log failed:', err)
  }
}

export default withCors(handler)

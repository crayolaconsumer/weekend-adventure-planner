/**
 * /api/admin/campaigns
 *
 * Operator CRUD for sponsored_places + business_profiles. Mirrors the
 * security posture of /api/admin/reports — 404 on every reject path,
 * IP rate limit before auth, Origin/Referer gate, is_admin enforcement,
 * fresh-login required for create/cancel, append-only audit log.
 *
 * Methods
 *   GET   → list active + draft + paused campaigns with business info
 *           and rolled-up impression/click stats
 *   POST  → create a campaign (auto-creates the business_profile if it
 *           doesn't exist yet, keyed by business_email)
 *   PATCH → update status (pause/resume/cancel/activate) or budget/dates
 *   DELETE → mark cancelled (we never hard-delete; cancelled rows stay
 *            for audit + historical reporting)
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, update, insert } from '../lib/db.js'
import { withCors, ALLOWED_ORIGINS } from '../lib/cors.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

const VALID_STATUSES = new Set(['draft', 'active', 'paused', 'completed', 'cancelled'])
const VALID_TRANSITIONS = new Set(['draft', 'active', 'paused', 'cancelled'])

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
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, `admin-camp-ip:${ipKey}`)
  if (rateLimitError) return NOT_FOUND(res)

  if (!isOriginAllowed(req)) return NOT_FOUND(res)

  const user = await getUserFromRequest(req)
  if (!user || !user.is_admin) return NOT_FOUND(res)

  if (req.method === 'GET') return handleList(req, res)
  if (req.method === 'POST') return handleCreate(req, res, user, ipKey)
  if (req.method === 'PATCH') return handleUpdate(req, res, user, ipKey)
  if (req.method === 'DELETE') return handleCancel(req, res, user, ipKey)
  return NOT_FOUND(res)
}

async function handleList(req, res) {
  const status = req.query.status && VALID_STATUSES.has(req.query.status) ? req.query.status : null

  const where = []
  const params = []
  if (status) {
    where.push('sp.status = ?')
    params.push(status)
  } else {
    // Default: show everything that's not cancelled, with the
    // already-cancelled ones lowest-priority sorted at the bottom.
    where.push("sp.status != 'cancelled'")
  }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = await query(
    `SELECT
       sp.id, sp.place_id, sp.place_data, sp.campaign_name, sp.status,
       sp.budget_total_pence, sp.budget_spent_pence, sp.cpm_pence,
       sp.target_categories, sp.target_radius_km,
       sp.start_date, sp.end_date,
       sp.created_at, sp.updated_at,
       bp.id AS business_id,
       bp.business_name, bp.business_email, bp.business_phone,
       bp.verified, bp.tier AS business_tier,
       COALESCE((
         SELECT COUNT(*) FROM ad_impressions ai
          WHERE ai.sponsored_place_id = sp.id
       ), 0) AS impression_count,
       COALESCE((
         SELECT COUNT(*) FROM ad_impressions ai
          WHERE ai.sponsored_place_id = sp.id AND ai.clicked = TRUE
       ), 0) AS click_count,
       COALESCE((
         SELECT COUNT(*) FROM ad_impressions ai
          WHERE ai.sponsored_place_id = sp.id AND ai.saved = TRUE
       ), 0) AS save_count
     FROM sponsored_places sp
     LEFT JOIN business_profiles bp ON sp.business_id = bp.id
     ${whereClause}
     ORDER BY
       FIELD(sp.status, 'active', 'paused', 'draft', 'completed', 'cancelled'),
       sp.created_at DESC
     LIMIT 200`,
    params
  )

  return res.status(200).json({ campaigns: rows, total: rows.length })
}

async function handleCreate(req, res, user, ipKey) {
  if (!(await requireFreshLogin(user.id))) {
    return res.status(401).json({ error: 'Please sign in again', code: 'STALE_SESSION' })
  }

  const body = req.body || {}
  const {
    place_id,
    place_name,
    place_lat,
    place_lng,
    place_category,
    place_image,
    campaign_name,
    business_name,
    business_email,
    business_phone,
    budget_total_pence,
    cpm_pence = 1000,
    target_categories,
    target_radius_km = 50,
    start_date,
    end_date,
    activate_immediately = false,
  } = body

  // Validation
  if (typeof place_id !== 'string' || place_id.length < 1 || place_id.length > 255) {
    return res.status(400).json({ error: 'place_id is required (1–255 chars)' })
  }
  if (typeof place_name !== 'string' || place_name.length < 1) {
    return res.status(400).json({ error: 'place_name is required' })
  }
  if (typeof place_lat !== 'number' || place_lat < -90 || place_lat > 90) {
    return res.status(400).json({ error: 'place_lat is required (valid latitude)' })
  }
  if (typeof place_lng !== 'number' || place_lng < -180 || place_lng > 180) {
    return res.status(400).json({ error: 'place_lng is required (valid longitude)' })
  }
  if (typeof business_name !== 'string' || business_name.length < 1) {
    return res.status(400).json({ error: 'business_name is required' })
  }
  if (typeof business_email !== 'string' || !business_email.includes('@')) {
    return res.status(400).json({ error: 'business_email is required (valid email)' })
  }
  if (typeof budget_total_pence !== 'number' || budget_total_pence < 0) {
    return res.status(400).json({ error: 'budget_total_pence is required (>=0; 0 = unlimited)' })
  }
  // Without this, a negative cpm_pence would make every ad impression
  // DECREASE budget_spent_pence (impression handler does +=cpm_pence/1000),
  // so the budget never exhausts. PATCH already guards against this; the
  // create path was missing the check.
  if (typeof cpm_pence !== 'number' || cpm_pence < 0) {
    return res.status(400).json({ error: 'cpm_pence must be a non-negative number' })
  }
  if (typeof target_radius_km !== 'number' || target_radius_km < 1 || target_radius_km > 500) {
    return res.status(400).json({ error: 'target_radius_km must be between 1 and 500' })
  }
  if (typeof start_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
    return res.status(400).json({ error: 'start_date is required (YYYY-MM-DD)' })
  }
  if (typeof end_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
    return res.status(400).json({ error: 'end_date is required (YYYY-MM-DD)' })
  }
  if (end_date < start_date) {
    return res.status(400).json({ error: 'end_date must be on or after start_date' })
  }

  // Upsert business_profile keyed on (admin user_id, place_id) — the
  // admin is the placeholder owner until we wire real business signup.
  let business = await queryOne(
    'SELECT id FROM business_profiles WHERE user_id = ? AND place_id = ? LIMIT 1',
    [user.id, place_id]
  )

  if (!business) {
    const bizInsertId = await insert(
      `INSERT INTO business_profiles
         (user_id, place_id, business_name, business_email, business_phone,
          verified, verified_at, verification_method, tier)
       VALUES (?, ?, ?, ?, ?, TRUE, NOW(), 'manual', 'essential')`,
      [user.id, place_id, business_name, business_email, business_phone || null]
    )
    business = { id: bizInsertId }
  } else {
    // Update the contact details so they stay current
    await update(
      `UPDATE business_profiles
          SET business_name = ?, business_email = ?, business_phone = ?
        WHERE id = ?`,
      [business_name, business_email, business_phone || null, business.id]
    )
  }

  const placeData = {
    id: place_id,
    name: place_name,
    lat: place_lat,
    lng: place_lng,
    category: place_category || null,
    image: place_image || null,
  }

  const status = activate_immediately ? 'active' : 'draft'

  const campaignId = await insert(
    `INSERT INTO sponsored_places
       (place_id, business_id, place_data, campaign_name, status,
        budget_total_pence, budget_spent_pence, cpm_pence,
        target_categories, target_radius_km,
        start_date, end_date)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    [
      place_id,
      business.id,
      JSON.stringify(placeData),
      campaign_name || null,
      status,
      budget_total_pence,
      cpm_pence,
      target_categories ? JSON.stringify(target_categories) : null,
      target_radius_km,
      start_date,
      end_date,
    ]
  )

  await auditLog(user.id, `campaign.create.${status}`, 'sponsored_place', String(campaignId), {
    place_id,
    business_id: business.id,
    budget_total_pence,
  }, ipKey, req.headers?.['user-agent'])

  return res.status(201).json({ success: true, id: campaignId, status })
}

async function handleUpdate(req, res, user, ipKey) {
  const body = req.body || {}
  const { id, status, budget_total_pence, cpm_pence, target_categories, target_radius_km, start_date, end_date, campaign_name } = body

  if (!Number.isInteger(id) || id <= 0) return NOT_FOUND(res)

  const existing = await queryOne(
    'SELECT id, status, start_date, end_date FROM sponsored_places WHERE id = ?',
    [id]
  )
  if (!existing) return NOT_FOUND(res)

  const updates = []
  const params = []

  if (status !== undefined) {
    if (!VALID_TRANSITIONS.has(status)) {
      return res.status(400).json({ error: 'Invalid status transition' })
    }
    updates.push('status = ?')
    params.push(status)
  }
  if (budget_total_pence !== undefined) {
    if (typeof budget_total_pence !== 'number' || budget_total_pence < 0) {
      return res.status(400).json({ error: 'Invalid budget_total_pence' })
    }
    updates.push('budget_total_pence = ?')
    params.push(budget_total_pence)
  }
  if (cpm_pence !== undefined) {
    if (typeof cpm_pence !== 'number' || cpm_pence < 0) {
      return res.status(400).json({ error: 'Invalid cpm_pence' })
    }
    updates.push('cpm_pence = ?')
    params.push(cpm_pence)
  }
  if (target_categories !== undefined) {
    updates.push('target_categories = ?')
    params.push(target_categories ? JSON.stringify(target_categories) : null)
  }
  if (target_radius_km !== undefined) {
    if (typeof target_radius_km !== 'number' || target_radius_km < 1 || target_radius_km > 500) {
      return res.status(400).json({ error: 'Invalid target_radius_km (1–500)' })
    }
    updates.push('target_radius_km = ?')
    params.push(target_radius_km)
  }
  if (start_date !== undefined) {
    if (typeof start_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
      return res.status(400).json({ error: 'Invalid start_date' })
    }
    updates.push('start_date = ?')
    params.push(start_date)
  }
  if (end_date !== undefined) {
    if (typeof end_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      return res.status(400).json({ error: 'Invalid end_date' })
    }
    updates.push('end_date = ?')
    params.push(end_date)
  }
  if (campaign_name !== undefined) {
    updates.push('campaign_name = ?')
    params.push(campaign_name || null)
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No updateable fields supplied' })
  }

  // Cross-field date validation. When the client PATCHes only one of
  // {start_date, end_date}, we'd otherwise let them set start > end
  // (the create-time check `end_date >= start_date` only fires when
  // both are supplied). An active campaign with reversed dates never
  // matches /api/ads/sponsored's date filter, so it'd silently never
  // serve. Validate against the merged final state.
  const finalStart = start_date !== undefined ? start_date : toISODate(existing.start_date)
  const finalEnd = end_date !== undefined ? end_date : toISODate(existing.end_date)
  if (finalStart && finalEnd && finalEnd < finalStart) {
    return res.status(400).json({ error: 'end_date must be on or after start_date' })
  }

  // State-changing edits (status flips to active, or budget change)
  // require fresh login. Read-only metadata edits don't.
  const isStateChange = status !== undefined || budget_total_pence !== undefined
  if (isStateChange && !(await requireFreshLogin(user.id))) {
    return res.status(401).json({ error: 'Please sign in again', code: 'STALE_SESSION' })
  }

  params.push(id)
  await update(
    `UPDATE sponsored_places SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
    params
  )

  await auditLog(user.id, `campaign.update`, 'sponsored_place', String(id), { changes: body }, ipKey, req.headers?.['user-agent'])

  return res.status(200).json({ success: true, id })
}

async function handleCancel(req, res, user, ipKey) {
  if (!(await requireFreshLogin(user.id))) {
    return res.status(401).json({ error: 'Please sign in again', code: 'STALE_SESSION' })
  }

  const { id } = req.body || {}
  if (!Number.isInteger(id) || id <= 0) return NOT_FOUND(res)

  const existing = await queryOne('SELECT id FROM sponsored_places WHERE id = ?', [id])
  if (!existing) return NOT_FOUND(res)

  await update(
    `UPDATE sponsored_places SET status = 'cancelled', updated_at = NOW() WHERE id = ?`,
    [id]
  )

  await auditLog(user.id, 'campaign.cancel', 'sponsored_place', String(id), null, ipKey, req.headers?.['user-agent'])

  return res.status(200).json({ success: true })
}

// MySQL DATE columns come back from mysql2 as JavaScript Date objects;
// the rest of the validation works on YYYY-MM-DD strings so we
// normalise. Slicing the ISO string is safer than toLocaleDateString
// (timezone-stable) for date-only comparison.
function toISODate(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

async function auditLog(adminId, action, targetType, targetId, metadata, ip, userAgent) {
  try {
    await insert(
      `INSERT INTO admin_actions
         (admin_id, action, target_type, target_id, ip, user_agent, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        adminId,
        action,
        targetType,
        targetId,
        ip,
        (userAgent || '').slice(0, 500),
        metadata ? JSON.stringify(metadata) : null,
      ]
    )
  } catch (err) {
    console.error('admin audit log failed:', err)
  }
}

export default withCors(handler)

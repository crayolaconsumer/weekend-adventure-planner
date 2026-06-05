/**
 * /api/partners/events
 *
 *   GET    -> list the current partner's events (with impression/click stats),
 *             or a single event with ?id=
 *   POST   -> create a draft promoted event
 *   PATCH  -> update an editable (draft / pending_payment) event you own
 *   DELETE -> cancel an event you own (?id=)
 *
 * All rows are scoped to the caller's partner_accounts row — a partner can
 * only ever see or mutate their own events.
 */

import { requireAuth } from '../lib/auth.js'
import { queryOne, query } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'
import { isFeatureEnabled } from '../lib/flags.js'
import { parseCoordinates, validateId, sanitizeString } from '../lib/validation.js'
import { quotePromotion, clampRadiusKm } from '../lib/promoPricing.js'

// Aligns with src/pages/Events/constants.ts CATEGORIES ids.
const ALLOWED_CATEGORIES = new Set([
  'music', 'comedy', 'theatre', 'sports', 'nightlife', 'food', 'family', 'culture', 'entertainment'
])
// online + door can combine ('online_door'); 'free' is exclusive.
const TICKET_TYPES = new Set(['online', 'door', 'free', 'online_door'])

async function handler(req, res) {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const isWrite = req.method !== 'GET'
  const rateLimitError = applyRateLimit(
    req, res,
    isWrite ? RATE_LIMITS.API_WRITE : RATE_LIMITS.API_GENERAL,
    'partners:events'
  )
  if (rateLimitError) return res.status(rateLimitError.status).json(rateLimitError)

  if (!(await isFeatureEnabled('promotedEvents'))) {
    return res.status(503).json({ error: 'Partner platform is temporarily unavailable' })
  }

  const user = await requireAuth(req, res)
  if (!user) return

  try {
    const partner = await queryOne('SELECT id, status FROM partner_accounts WHERE user_id = ?', [user.id])
    if (!partner) {
      return res.status(403).json({ error: 'No partner account', code: 'NO_PARTNER' })
    }
    // A suspended partner can still view their events, but not mutate them.
    if (req.method !== 'GET' && partner.status !== 'active') {
      return res.status(403).json({ error: 'This partner account is suspended', code: 'PARTNER_SUSPENDED' })
    }

    if (req.method === 'GET') return handleGet(req, res, partner.id)
    if (req.method === 'POST') return handleCreate(req, res, partner.id)
    if (req.method === 'PATCH') return handleUpdate(req, res, partner.id)
    if (req.method === 'DELETE') return handleCancel(req, res, partner.id)
  } catch (error) {
    console.error('Partner events error:', error)
    return res.status(500).json({ error: 'Failed to process request' })
  }
}

async function handleGet(req, res, partnerId) {
  const idParam = req.query.id
  if (idParam) {
    const idCheck = validateId(idParam)
    if (!idCheck.valid) return res.status(400).json({ error: 'Invalid id' })
    const event = await queryOne(
      `SELECT * FROM promoted_events WHERE id = ? AND partner_id = ?`,
      [idCheck.id, partnerId]
    )
    if (!event) return res.status(404).json({ error: 'Not found' })
    const stats = await statsFor(idCheck.id)
    return res.status(200).json({ event: { ...event, stats } })
  }

  const events = await query(
    `SELECT pe.*,
       COUNT(pei.id) AS impressions,
       SUM(pei.clicked) AS clicks,
       SUM(pei.saved) AS saves
     FROM promoted_events pe
     LEFT JOIN promoted_event_impressions pei ON pei.promoted_event_id = pe.id
     WHERE pe.partner_id = ?
     GROUP BY pe.id
     ORDER BY pe.created_at DESC`,
    [partnerId]
  )
  return res.status(200).json({ events })
}

async function handleCreate(req, res, partnerId) {
  const parsed = parseEventBody(req.body)
  if (!parsed.valid) return res.status(400).json({ error: parsed.message })
  const v = parsed.value

  const quote = quotePromotion({ radiusKm: v.promo_radius_km, startOn: v.promo_starts_on, endOn: v.promo_ends_on, pushBoost: !!v.push_boost })
  if (!quote.valid) return res.status(400).json({ error: quote.message })

  const result = await query(
    `INSERT INTO promoted_events
       (partner_id, title, description, category, venue_name, address, lat, lng,
        starts_at, ends_at, image_url, info_url, price_info, ticket_type,
        promo_radius_km, promo_starts_on, promo_ends_on, price_paid_pence, currency, push_boost,
        payment_status, moderation_status, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', 'live', 'draft')`,
    [
      partnerId, v.title, v.description, v.category, v.venue_name, v.address, v.lat, v.lng,
      v.starts_at, v.ends_at, v.image_url, v.info_url, v.price_info, v.ticket_type,
      quote.radiusKm, v.promo_starts_on, v.promo_ends_on, quote.pricePence, quote.currency, v.push_boost
    ]
  )
  const id = result.insertId
  const event = await queryOne('SELECT * FROM promoted_events WHERE id = ?', [id])
  return res.status(201).json({ event, quote })
}

async function handleUpdate(req, res, partnerId) {
  const idCheck = validateId(req.body?.id)
  if (!idCheck.valid) return res.status(400).json({ error: 'Invalid id' })

  const current = await queryOne(
    'SELECT * FROM promoted_events WHERE id = ? AND partner_id = ?',
    [idCheck.id, partnerId]
  )
  if (!current) return res.status(404).json({ error: 'Not found' })
  if (current.status === 'cancelled' || current.status === 'expired') {
    return res.status(409).json({ error: 'This event can no longer be edited' })
  }

  const isPaid = current.payment_status === 'paid'
  const parsed = parseEventBody(req.body, { contentOnly: isPaid })
  if (!parsed.valid) return res.status(400).json({ error: parsed.message })
  const v = parsed.value

  // A LIVE (paid) event stays editable for content, but its reach/dates/price/
  // boost are locked — those were paid for. Only draft/pending events re-quote.
  if (isPaid) {
    await query(
      `UPDATE promoted_events SET
         title = ?, description = ?, category = ?, venue_name = ?, address = ?, lat = ?, lng = ?,
         starts_at = ?, ends_at = ?, image_url = ?, info_url = ?, price_info = ?, ticket_type = ?
       WHERE id = ? AND partner_id = ?`,
      [
        v.title, v.description, v.category, v.venue_name, v.address, v.lat, v.lng,
        v.starts_at, v.ends_at, v.image_url, v.info_url, v.price_info, v.ticket_type,
        idCheck.id, partnerId
      ]
    )
    const event = await queryOne('SELECT * FROM promoted_events WHERE id = ?', [idCheck.id])
    // Include stats so the client's setEvent(res.event) keeps the live counts.
    const stats = await statsFor(idCheck.id)
    return res.status(200).json({ event: { ...event, stats } })
  }

  const quote = quotePromotion({ radiusKm: v.promo_radius_km, startOn: v.promo_starts_on, endOn: v.promo_ends_on, pushBoost: !!v.push_boost })
  if (!quote.valid) return res.status(400).json({ error: quote.message })

  await query(
    `UPDATE promoted_events SET
       title = ?, description = ?, category = ?, venue_name = ?, address = ?, lat = ?, lng = ?,
       starts_at = ?, ends_at = ?, image_url = ?, info_url = ?, price_info = ?, ticket_type = ?,
       promo_radius_km = ?, promo_starts_on = ?, promo_ends_on = ?, price_paid_pence = ?, push_boost = ?
     WHERE id = ? AND partner_id = ?`,
    [
      v.title, v.description, v.category, v.venue_name, v.address, v.lat, v.lng,
      v.starts_at, v.ends_at, v.image_url, v.info_url, v.price_info, v.ticket_type,
      quote.radiusKm, v.promo_starts_on, v.promo_ends_on, quote.pricePence, v.push_boost,
      idCheck.id, partnerId
    ]
  )
  const event = await queryOne('SELECT * FROM promoted_events WHERE id = ?', [idCheck.id])
  return res.status(200).json({ event, quote })
}

async function handleCancel(req, res, partnerId) {
  const idCheck = validateId(req.query.id)
  if (!idCheck.valid) return res.status(400).json({ error: 'Invalid id' })
  const current = await queryOne(
    'SELECT id, status, payment_status FROM promoted_events WHERE id = ? AND partner_id = ?',
    [idCheck.id, partnerId]
  )
  if (!current) return res.status(404).json({ error: 'Not found' })
  // A paid event represents money taken — don't let self-serve cancel strand a
  // charge; route to support for a refund (which flips it via the webhook).
  if (current.payment_status === 'paid') {
    return res.status(409).json({ error: 'Paid events can’t be cancelled here — contact support for a refund.', code: 'PAID_NO_CANCEL' })
  }
  await query(
    `UPDATE promoted_events SET status = 'cancelled' WHERE id = ? AND partner_id = ?`,
    [idCheck.id, partnerId]
  )
  return res.status(200).json({ success: true })
}

async function statsFor(eventId) {
  const row = await queryOne(
    `SELECT COUNT(*) AS impressions, SUM(clicked) AS clicks, SUM(saved) AS saves
     FROM promoted_event_impressions WHERE promoted_event_id = ?`,
    [eventId]
  )
  return {
    impressions: Number(row?.impressions || 0),
    clicks: Number(row?.clicks || 0),
    saves: Number(row?.saves || 0)
  }
}

/** Validate + normalise an event payload shared by create/update.
 *  contentOnly=true skips promotion-field validation (used for paid live edits). */
function parseEventBody(body, { contentOnly = false } = {}) {
  if (!body || typeof body !== 'object') return { valid: false, message: 'Missing body' }

  const title = sanitizeString(body.title)
  if (!title || title.length < 2 || title.length > 160) {
    return { valid: false, message: 'Title must be 2–160 characters' }
  }

  const description = body.description ? sanitizeString(body.description).slice(0, 2000) : null
  if (description && /<script|javascript:|data:/i.test(description)) {
    return { valid: false, message: 'Description contains invalid characters' }
  }

  let category = body.category ? String(body.category).toLowerCase() : null
  if (category && !ALLOWED_CATEGORIES.has(category)) {
    return { valid: false, message: 'Invalid category' }
  }

  const venue_name = body.venue_name ? sanitizeString(body.venue_name).slice(0, 200) : null
  const address = body.address ? sanitizeString(body.address).slice(0, 300) : null

  const coords = parseCoordinates(body.lat, body.lng)
  if (!coords.valid) return { valid: false, message: 'A valid event location is required' }

  const starts_at = toDateTime(body.starts_at)
  if (!starts_at) return { valid: false, message: 'A valid start date/time is required' }
  const ends_at = body.ends_at ? toDateTime(body.ends_at) : null
  if (body.ends_at && !ends_at) return { valid: false, message: 'Invalid end date/time' }
  if (ends_at && ends_at < starts_at) return { valid: false, message: 'End must be after start' }

  const image_url = body.image_url ? sanitizeString(body.image_url).slice(0, 500) : null
  if (image_url && !isHttpUrl(image_url)) return { valid: false, message: 'Invalid image URL' }
  const info_url = body.info_url ? sanitizeString(body.info_url).slice(0, 500) : null
  if (info_url && !isHttpUrl(info_url)) return { valid: false, message: 'Invalid info/ticket URL' }

  const price_info = body.price_info ? sanitizeString(body.price_info).slice(0, 60) : null
  const ticket_type = TICKET_TYPES.has(body.ticket_type) ? body.ticket_type : 'online'
  const push_boost = (body.push_boost === true || body.push_boost === 1) ? 1 : 0

  // Promotion fields are validated ONLY when they're editable (draft/pending).
  // For a paid event (contentOnly) they're locked and ignored, so a content
  // edit must not be blocked by e.g. "promotion end date is in the past".
  let promo_radius_km = null
  let promo_starts_on = null
  let promo_ends_on = null
  if (!contentOnly) {
    promo_radius_km = clampRadiusKm(body.promo_radius_km)
    promo_starts_on = toDateOnly(body.promo_starts_on)
    promo_ends_on = toDateOnly(body.promo_ends_on)
    if (!promo_starts_on || !promo_ends_on) {
      return { valid: false, message: 'Valid promotion start and end dates are required' }
    }
    if (promo_ends_on < promo_starts_on) {
      return { valid: false, message: 'Promotion end must be on or after the start' }
    }
    // Don't price/charge for a promotion window that has already finished.
    const todayIso = new Date().toISOString().slice(0, 10)
    if (promo_ends_on < todayIso) {
      return { valid: false, message: 'The promotion end date is in the past' }
    }
  }

  return {
    valid: true,
    value: {
      title, description, category, venue_name, address,
      lat: coords.lat, lng: coords.lng,
      starts_at, ends_at, image_url, info_url, price_info, ticket_type, push_boost,
      promo_radius_km, promo_starts_on, promo_ends_on
    }
  }
}

/** Parse to a MySQL DATETIME string 'YYYY-MM-DD HH:MM:SS' (UTC). */
function toDateTime(value) {
  if (typeof value !== 'string' && !(value instanceof Date)) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

/** Parse to a 'YYYY-MM-DD' date string. */
function toDateOnly(value) {
  if (typeof value !== 'string' && !(value instanceof Date)) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function isHttpUrl(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export default withCors(handler)

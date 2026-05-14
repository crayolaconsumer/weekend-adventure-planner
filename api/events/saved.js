/**
 * GET/POST/DELETE /api/events/saved
 *
 * Manage saved events for authenticated users.
 */

import { getUserFromRequest, getUserLimits } from '../lib/auth.js'
import { query, queryOne, update } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'

const parseEventData = (raw, eventId) => {
  if (!raw) return {}

  if (typeof raw === 'object') {
    return raw
  }

  let text = raw
  if (raw && raw.constructor?.name === 'Buffer') {
    text = raw.toString('utf8')
  }

  if (typeof text !== 'string') {
    return {}
  }

  try {
    return JSON.parse(text)
  } catch {
    console.warn('Invalid event_data JSON for saved event', eventId)
    return {}
  }
}

async function handler(req, res) {
  // Apply rate limiting
  const rateLimit = req.method === 'GET' ? RATE_LIMITS.API_GENERAL : RATE_LIMITS.API_WRITE
  const rateLimitError = applyRateLimit(req, res, rateLimit, 'events:saved')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res, user)
      case 'POST':
        return await handlePost(req, res, user)
      case 'DELETE':
        return await handleDelete(req, res, user)
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('Saved events error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * Determine whether a saved-event record's date has already passed.
 * Use the END time if present (so multi-day festivals stay surfaced
 * until the last day ends), else the START time. Events with no
 * parseable date are kept — better to leak a dead row than hide a
 * live one.
 */
function isEventPast(eventData) {
  const dateStr = eventData?.datetime?.end || eventData?.datetime?.start
  if (!dateStr) return false
  const eventDate = new Date(dateStr)
  if (Number.isNaN(eventDate.getTime())) return false
  return eventDate.getTime() < Date.now()
}

/**
 * GET - Retrieve all saved events for user (future events only).
 *
 * Past events are filtered server-side so the wishlist UI doesn't
 * surface gigs the user can no longer attend. Rows are kept in the
 * DB — we may want to show a "Past events" archive later, and
 * deletion would lose the user's history. If storage becomes a
 * concern, a follow-up cron can hard-delete rows older than 30 days
 * past their end date.
 */
async function handleGet(req, res, user) {
  const { limit = 100, offset = 0 } = req.query

  // Validate pagination bounds
  const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 100), 200)
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0)

  const events = await query(
    `SELECT id, event_id, event_source, event_data, saved_at
     FROM saved_events
     WHERE user_id = ?
     ORDER BY saved_at DESC
     LIMIT ? OFFSET ?`,
    [user.id, safeLimit, safeOffset]
  )

  const futureEvents = events
    .map(row => ({
      raw: row,
      parsed: parseEventData(row.event_data, row.event_id)
    }))
    .filter(({ parsed }) => !isEventPast(parsed))
    .map(({ raw, parsed }) => ({
      ...parsed,
      id: raw.event_id,
      source: raw.event_source,
      savedAt: new Date(raw.saved_at).getTime()
    }))

  // Total reflects the filtered (future-only) set so the count badge
  // in the UI matches what the user sees on screen. Past events still
  // occupy DB rows but are invisible to the client.
  return res.status(200).json({
    events: futureEvents,
    total: futureEvents.length
  })
}

/**
 * POST - Save an event
 */
// Maximum JSON data size (10KB)
const MAX_JSON_SIZE = 10 * 1024

async function handlePost(req, res, user) {
  const { event } = req.body

  if (!event || !event.id) {
    return res.status(400).json({ error: 'Event with id is required' })
  }

  const eventId = event.id
  const eventSource = event.source || 'skiddle'
  const eventData = { ...event }
  delete eventData.savedAt

  // Validate JSON size
  const eventDataJson = JSON.stringify(eventData)
  if (eventDataJson.length > MAX_JSON_SIZE) {
    return res.status(400).json({ error: 'Event data too large (max 10KB)' })
  }

  // Check if already saved
  const existing = await queryOne(
    'SELECT id FROM saved_events WHERE user_id = ? AND event_id = ?',
    [user.id, eventId]
  )

  if (existing) {
    return res.status(200).json({
      success: true,
      alreadySaved: true,
      event: { ...eventData, id: eventId, savedAt: Date.now() }
    })
  }

  // Check saved events limit for new saves
  const limits = getUserLimits(user)
  if (limits.maxSavedEvents !== Infinity) {
    const countResult = await queryOne(
      'SELECT COUNT(*) as count FROM saved_events WHERE user_id = ?',
      [user.id]
    )
    if (countResult.count >= limits.maxSavedEvents) {
      return res.status(403).json({
        error: 'Saved events limit reached',
        limit: limits.maxSavedEvents,
        upgrade: true
      })
    }
  }

  await query(
    `INSERT INTO saved_events (user_id, event_id, event_source, event_data, saved_at)
     VALUES (?, ?, ?, ?, NOW())`,
    [user.id, eventId, eventSource, JSON.stringify(eventData)]
  )

  return res.status(201).json({
    success: true,
    event: { ...eventData, id: eventId, savedAt: Date.now() }
  })
}

/**
 * DELETE - Remove a saved event
 */
async function handleDelete(req, res, user) {
  const { eventId } = req.query

  if (!eventId) {
    return res.status(400).json({ error: 'eventId query parameter is required' })
  }

  const affected = await update(
    'DELETE FROM saved_events WHERE user_id = ? AND event_id = ?',
    [user.id, eventId]
  )

  return res.status(200).json({
    success: true,
    deleted: affected > 0
  })
}

export default withCors(handler)

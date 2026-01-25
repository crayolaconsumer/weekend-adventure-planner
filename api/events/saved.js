/**
 * GET/POST/DELETE /api/events/saved
 *
 * Manage saved events for authenticated users.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, update } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

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

export default async function handler(req, res) {
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
 * GET - Retrieve all saved events for user
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

  const formattedEvents = events.map(row => ({
    ...parseEventData(row.event_data, row.event_id),
    id: row.event_id,
    source: row.event_source,
    savedAt: new Date(row.saved_at).getTime()
  }))

  const countResult = await queryOne(
    'SELECT COUNT(*) as total FROM saved_events WHERE user_id = ?',
    [user.id]
  )

  return res.status(200).json({
    events: formattedEvents,
    total: countResult.total
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

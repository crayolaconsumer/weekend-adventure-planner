/**
 * POST /api/events/promoted-impression
 *
 * Track impressions, clicks and saves for promoted ("Featured") events in the
 * What's On feed. Fire-and-forget from the client.
 *
 * Mirrors /api/ads/impression but for promoted_events. Flat-fee model, so this
 * is analytics only — there is no budget to decrement.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, insert, update } from '../lib/db.js'
import { parseCoordinates, validateId } from '../lib/validation.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'

async function handler(req, res) {
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'events:promoted-impression')
  if (rateLimitError) {
    return res.status(200).json({ success: false, rateLimited: true })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { promoted_event_id, session_id, action, user_lat, user_lng } = req.body || {}

    if (!promoted_event_id || !session_id || !action) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const idValidation = validateId(promoted_event_id)
    if (!idValidation.valid) {
      return res.status(400).json({ error: 'Invalid promoted_event_id' })
    }

    if (typeof session_id !== 'string' || session_id.trim().length < 10 || session_id.length > 100) {
      return res.status(400).json({ error: 'Invalid session_id' })
    }

    if (!['impression', 'click', 'save'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action type' })
    }

    let validatedLat = null
    let validatedLng = null
    if (user_lat && user_lng) {
      const coords = parseCoordinates(user_lat, user_lng)
      if (coords.valid) {
        validatedLat = coords.lat
        validatedLng = coords.lng
      }
    }

    const user = await getUserFromRequest(req)
    const userId = user?.id || null

    if (action === 'impression') {
      const existing = await query(
        `SELECT id FROM promoted_event_impressions
         WHERE promoted_event_id = ? AND session_id = ?`,
        [idValidation.id, session_id]
      )
      if (existing.length > 0) {
        return res.status(200).json({ success: true, duplicate: true })
      }
      await insert(
        `INSERT INTO promoted_event_impressions
         (promoted_event_id, user_id, session_id, user_lat, user_lng)
         VALUES (?, ?, ?, ?, ?)`,
        [idValidation.id, userId, session_id, validatedLat, validatedLng]
      )
      return res.status(200).json({ success: true, action: 'impression' })
    }

    if (action === 'click') {
      await update(
        `UPDATE promoted_event_impressions
         SET clicked = TRUE, clicked_at = NOW()
         WHERE promoted_event_id = ? AND session_id = ? AND clicked = FALSE
         ORDER BY impressed_at DESC
         LIMIT 1`,
        [idValidation.id, session_id]
      )
      return res.status(200).json({ success: true, action: 'click' })
    }

    if (action === 'save') {
      await update(
        `UPDATE promoted_event_impressions
         SET saved = TRUE
         WHERE promoted_event_id = ? AND session_id = ?
         ORDER BY impressed_at DESC
         LIMIT 1`,
        [idValidation.id, session_id]
      )
      return res.status(200).json({ success: true, action: 'save' })
    }
  } catch (error) {
    console.error('Promoted event impression tracking error:', error)
    return res.status(200).json({ success: false, error: 'Tracking failed' })
  }
}

export default withCors(handler)

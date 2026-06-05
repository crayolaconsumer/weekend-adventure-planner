/**
 * POST /api/users/location
 *
 * Stores ONE coarse (rounded ~1km) last-known location per signed-in user, so
 * the promoted-event push jobs can decide who is "near" an event. The app posts
 * this opportunistically when it already has the user's location; we never ask
 * for location just for this. Rounding is deliberate privacy hygiene — we only
 * need town-level precision for "events near you".
 */

import { requireAuth } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { parseCoordinates } from '../lib/validation.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, 'users:location')
  if (rateLimitError) return res.status(rateLimitError.status).json(rateLimitError)

  const user = await requireAuth(req, res)
  if (!user) return

  const coords = parseCoordinates(req.body?.lat, req.body?.lng)
  if (!coords.valid) {
    return res.status(400).json({ error: 'Invalid coordinates' })
  }

  // Coarsen to ~2 decimal places (~1.1km) before persisting.
  const lat = Math.round(coords.lat * 100) / 100
  const lng = Math.round(coords.lng * 100) / 100

  try {
    await query(
      `INSERT INTO user_locations (user_id, lat, lng)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE lat = VALUES(lat), lng = VALUES(lng)`,
      [user.id, lat, lng]
    )
    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('user location save error:', error)
    return res.status(500).json({ error: 'Failed to save location' })
  }
}

export default withCors(handler)

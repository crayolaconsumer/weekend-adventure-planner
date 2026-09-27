/**
 * POST /api/places/saved/migrate
 *
 * Migrate saved places from localStorage to database.
 * Called on first login to sync existing local saves.
 */

import { getUserFromRequest, getUserLimits } from '../../lib/auth.js'
import { query, queryOne } from '../../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../../lib/rateLimit.js'
import { withCors } from '../../lib/cors.js'

export const MAX_MIGRATE_PLACES = 500

async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Apply rate limiting (stricter for migration - one-time operation)
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, 'places:migrate')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  // Get authenticated user
  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  try {
    const { places } = req.body

    if (!Array.isArray(places)) {
      return res.status(400).json({ error: 'places must be an array' })
    }

    if (places.length > MAX_MIGRATE_PLACES) {
      return res.status(413).json({ error: `Too many places (max ${MAX_MIGRATE_PLACES})` })
    }

    if (places.length === 0) {
      return res.status(200).json({ success: true, migrated: 0, skipped: 0 })
    }

    let migrated = 0
    let skipped = 0
    let failed = 0

    // Pre-signup saves are the user's own data, so an account created in
    // the last day imports all of them, even past the free cap (the import
    // arrives in chunks, and retries after a failure, so "has no saves yet"
    // can't be the test). Older accounts keep the normal cap, so replaying
    // the import can't bypass it. Places already saved never use up the cap.
    const NEW_ACCOUNT_MS = 24 * 60 * 60 * 1000
    const limits = getUserLimits(user)
    const isNewAccount = user.created_at && Date.now() - new Date(user.created_at).getTime() < NEW_ACCOUNT_MS
    let remaining = Infinity
    let capped = 0
    if (limits.maxSavedPlaces !== Infinity && !isNewAccount) {
      const row = await queryOne('SELECT COUNT(*) AS count FROM saved_places WHERE user_id = ?', [user.id])
      remaining = limits.maxSavedPlaces - (Number(row?.count) || 0)
    }
    const batchSize = 50
    for (let i = 0; i < places.length; i += batchSize) {
      const batch = places.slice(i, i + batchSize)

      for (const place of batch) {
        if (!place || !place.id) {
          skipped++
          continue
        }
        if (remaining <= 0 && !(await queryOne(
          'SELECT 1 AS found FROM saved_places WHERE user_id = ? AND place_id = ?', [user.id, place.id]
        ))) {
          capped++
          continue
        }

        try {
          const placeId = place.id
          // A corrupt savedAt must not fail this row on every retry
          const parsed = place.savedAt ? new Date(place.savedAt) : null
          const savedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date()
          const placeData = { ...place }
          delete placeData.savedAt

          // INSERT IGNORE, not ON DUPLICATE KEY UPDATE: mysql2 sets
          // FOUND_ROWS, so the latter reports a duplicate as affectedRows 1
          // and already-saved places would use up the free cap
          const result = await query(
            `INSERT IGNORE INTO saved_places (user_id, place_id, place_data, saved_at)
             VALUES (?, ?, ?, ?)`,
            [user.id, placeId, JSON.stringify(placeData), savedAt]
          )

          // affectedRows 0 = already saved: counts as skipped, not against the cap
          if (result.affectedRows > 0) {
            migrated++
            remaining--
          } else skipped++
        } catch (err) {
          console.error('Migration error for place:', place.id, err.message)
          failed++
        }
      }
    }

    // failed > 0: the client keeps its local copy and retries next sign-in
    return res.status(200).json({
      success: failed === 0 && capped === 0, migrated, skipped, failed, capped, total: places.length,
      ...(capped > 0 && { limitReached: true, limit: limits.maxSavedPlaces })
    })
  } catch (error) {
    console.error('Migration error:', error)
    return res.status(500).json({ error: 'Migration failed' })
  }
}

export default withCors(handler)

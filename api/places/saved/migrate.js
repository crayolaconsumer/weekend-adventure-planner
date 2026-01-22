/**
 * POST /api/places/saved/migrate
 *
 * Migrate saved places from localStorage to database.
 * Called on first login to sync existing local saves.
 */

import { getUserFromRequest } from '../../lib/auth.js'
import { query } from '../../lib/db.js'

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
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

    if (places.length === 0) {
      return res.status(200).json({ success: true, migrated: 0, skipped: 0 })
    }

    let migrated = 0
    let skipped = 0

    // Process places in batches to avoid overwhelming the DB
    const batchSize = 50
    for (let i = 0; i < places.length; i += batchSize) {
      const batch = places.slice(i, i + batchSize)

      for (const place of batch) {
        if (!place || !place.id) {
          skipped++
          continue
        }

        try {
          const placeId = place.id
          const savedAt = place.savedAt ? new Date(place.savedAt) : new Date()
          const placeData = { ...place }
          delete placeData.savedAt

          // Insert with ON DUPLICATE KEY to skip existing
          const result = await query(
            `INSERT INTO saved_places (user_id, place_id, place_data, saved_at)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE id = id`,
            [user.id, placeId, JSON.stringify(placeData), savedAt]
          )

          // affectedRows is 1 for insert, 0 for duplicate skip
          if (result.affectedRows > 0) {
            migrated++
          } else {
            skipped++
          }
        } catch (err) {
          console.error('Migration error for place:', place.id, err.message)
          skipped++
        }
      }
    }

    return res.status(200).json({
      success: true,
      migrated,
      skipped,
      total: places.length
    })
  } catch (error) {
    console.error('Migration error:', error)
    return res.status(500).json({ error: 'Migration failed' })
  }
}

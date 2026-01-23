/**
 * POST /api/ads/impression
 *
 * Track ad impressions, clicks, and conversions for sponsored places.
 * This endpoint is designed to be fire-and-forget from the client.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, insert, update } from '../lib/db.js'

export default async function handler(req, res) {
  // Only POST is allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { sponsored_place_id, session_id, action, user_lat, user_lng } = req.body

    // Validate required fields
    if (!sponsored_place_id || !session_id || !action) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Validate action type
    if (!['impression', 'click', 'save'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action type' })
    }

    // Get user ID if authenticated (optional)
    const user = await getUserFromRequest(req)
    const userId = user?.id || null

    if (action === 'impression') {
      // Check if this session already has an impression for this sponsored place
      const existing = await query(
        `SELECT id FROM ad_impressions
         WHERE sponsored_place_id = ? AND session_id = ?`,
        [sponsored_place_id, session_id]
      )

      if (existing.length > 0) {
        // Already tracked - don't duplicate
        return res.status(200).json({ success: true, duplicate: true })
      }

      // Record new impression
      await insert(
        `INSERT INTO ad_impressions
         (sponsored_place_id, user_id, session_id, user_lat, user_lng)
         VALUES (?, ?, ?, ?, ?)`,
        [sponsored_place_id, userId, session_id, user_lat || null, user_lng || null]
      )

      // Update budget spent on the sponsored place (increment by 1 impression worth)
      // Cost = CPM / 1000 (cost per single impression)
      await update(
        `UPDATE sponsored_places
         SET budget_spent_pence = budget_spent_pence + (cpm_pence / 1000)
         WHERE id = ? AND status = 'active'`,
        [sponsored_place_id]
      )

      return res.status(200).json({ success: true, action: 'impression' })
    }

    if (action === 'click') {
      // Update the most recent impression for this session to mark as clicked
      await update(
        `UPDATE ad_impressions
         SET clicked = TRUE, clicked_at = NOW()
         WHERE sponsored_place_id = ? AND session_id = ? AND clicked = FALSE
         ORDER BY impressed_at DESC
         LIMIT 1`,
        [sponsored_place_id, session_id]
      )

      return res.status(200).json({ success: true, action: 'click' })
    }

    if (action === 'save') {
      // Update impression to mark as saved (conversion)
      await update(
        `UPDATE ad_impressions
         SET saved = TRUE
         WHERE sponsored_place_id = ? AND session_id = ?
         ORDER BY impressed_at DESC
         LIMIT 1`,
        [sponsored_place_id, session_id]
      )

      return res.status(200).json({ success: true, action: 'save' })
    }

  } catch (error) {
    console.error('Ad impression tracking error:', error)
    // Return 200 even on error - don't break client UX for tracking
    return res.status(200).json({ success: false, error: 'Tracking failed' })
  }
}

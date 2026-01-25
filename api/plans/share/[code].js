/**
 * GET /api/plans/share/:code
 *
 * Get a shared plan by share code (public, no auth required)
 */

import { query, queryOne } from '../../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../../lib/rateLimit.js'
import { validateShareCode } from '../../lib/validation.js'
import { getUserFromRequest } from '../../lib/auth.js'
import { hasBlockBetween } from '../../social/block.js'

// Safe JSON parse helper
const safeJsonParse = (data, defaultValue = {}) => {
  if (!data) return defaultValue
  if (typeof data === 'object') return data
  try {
    return JSON.parse(data)
  } catch {
    return defaultValue
  }
}

export default async function handler(req, res) {
  // L1: Check method before rate limiting
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limit to prevent enumeration attacks
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.SHARE_CODE_LOOKUP, 'share')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const { code } = req.query

  if (!code) {
    return res.status(400).json({ error: 'Share code required' })
  }

  // Validate share code format
  const codeValidation = validateShareCode(code)
  if (!codeValidation.valid) {
    return res.status(400).json({ error: codeValidation.message })
  }

  try {
    // Get plan by share code
    const plan = await queryOne(
      `SELECT
        p.*,
        u.username,
        u.display_name,
        u.avatar_url
      FROM plans p
      JOIN users u ON p.user_id = u.id
      WHERE p.share_code = ? AND p.is_public = 1`,
      [code]
    )

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found or not public' })
    }

    // Check if requesting user is blocked by plan owner
    const currentUser = await getUserFromRequest(req)
    if (currentUser && currentUser.id !== plan.user_id) {
      const blocked = await hasBlockBetween(currentUser.id, plan.user_id)
      if (blocked) {
        return res.status(404).json({ error: 'Plan not found or not public' })
      }
    }

    // Get stops
    const stops = await query(
      `SELECT * FROM plan_stops WHERE plan_id = ? ORDER BY sort_order ASC`,
      [plan.id]
    )

    const formattedStops = stops.map(s => ({
      id: s.id,
      placeId: s.place_id,
      placeData: safeJsonParse(s.place_data),
      sortOrder: s.sort_order,
      scheduledTime: s.scheduled_time,
      durationMinutes: s.duration_minutes
    }))

    return res.status(200).json({
      plan: {
        id: plan.id,
        shareCode: plan.share_code,
        title: plan.title,
        vibe: plan.vibe,
        durationHours: plan.duration_hours,
        createdAt: new Date(plan.created_at).toISOString(),
        user: {
          username: plan.username,
          displayName: plan.display_name,
          avatarUrl: plan.avatar_url
        },
        stops: formattedStops
      }
    })
  } catch (error) {
    console.error('Share plan error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

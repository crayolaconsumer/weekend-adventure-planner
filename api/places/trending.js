/**
 * GET /api/places/trending
 *
 * Get trending places based on recent activity
 * Calculates popularity from contributions, saves, and plan inclusions
 */

import { query } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Apply rate limiting
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'places:trending')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  try {
    const { limit = 10, days = 7 } = req.query

    // Apply bounds to prevent abuse
    const safeLimit = Math.min(Math.max(1, parseInt(limit) || 10), 50)
    const safeDays = Math.min(Math.max(1, parseInt(days) || 7), 30)

    // Get places with recent activity (only approved contributions)
    // Score = contributions + plan inclusions (weighted)
    // Note: plan_stops doesn't have created_at, so join through plans table
    const sql = `
      SELECT
        c.place_id,
        COUNT(DISTINCT c.id) as contribution_count,
        COUNT(DISTINCT recent_ps.id) as plan_inclusion_count,
        (COUNT(DISTINCT c.id) * 2 + COUNT(DISTINCT recent_ps.id)) as popularity_score,
        MAX(c.created_at) as last_activity
      FROM contributions c
      LEFT JOIN (
        SELECT ps.id, ps.place_id
        FROM plan_stops ps
        JOIN plans p ON ps.plan_id = p.id
        WHERE p.created_at > DATE_SUB(NOW(), INTERVAL ? DAY)
      ) recent_ps ON c.place_id = recent_ps.place_id
      WHERE c.created_at > DATE_SUB(NOW(), INTERVAL ? DAY)
        AND c.status = 'approved'
      GROUP BY c.place_id
      HAVING popularity_score > 0
      ORDER BY popularity_score DESC, last_activity DESC
      LIMIT ?
    `

    const trending = await query(sql, [safeDays, safeDays, safeLimit])

    // Get top contribution content for each trending place
    const placeIds = trending.map(t => t.place_id)

    let contributions = []
    if (placeIds.length > 0) {
      const placeholders = placeIds.map(() => '?').join(',')
      contributions = await query(
        `SELECT
          c.place_id,
          c.content,
          c.upvotes,
          c.downvotes,
          u.username,
          u.display_name
        FROM contributions c
        JOIN users u ON c.user_id = u.id
        WHERE c.place_id IN (${placeholders})
          AND c.contribution_type = 'tip'
          AND c.status IN ('approved', 'pending')
        ORDER BY (c.upvotes - c.downvotes) DESC`,
        placeIds
      )
    }

    // Group contributions by place
    const contributionsByPlace = {}
    for (const c of contributions) {
      if (!contributionsByPlace[c.place_id]) {
        contributionsByPlace[c.place_id] = c
      }
    }

    const result = trending.map(t => ({
      placeId: t.place_id,
      contributionCount: t.contribution_count,
      planCount: t.plan_inclusion_count,
      popularityScore: t.popularity_score,
      topTip: contributionsByPlace[t.place_id] ? {
        content: contributionsByPlace[t.place_id].content,
        username: contributionsByPlace[t.place_id].username,
        displayName: contributionsByPlace[t.place_id].display_name
      } : null
    }))

    return res.status(200).json({
      trending: result,
      period: `${days} days`
    })
  } catch (error) {
    console.error('Trending places error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

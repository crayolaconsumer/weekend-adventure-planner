/**
 * GET /api/contributions/batch
 *
 * Batch fetch top contributions for multiple places.
 * Used to efficiently show tips on swipe cards without N+1 queries.
 */

import { query } from '../lib/db.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { placeIds } = req.query

    if (!placeIds) {
      return res.status(400).json({ error: 'placeIds query parameter is required' })
    }

    // Parse place IDs (comma-separated)
    const ids = placeIds.split(',').map(id => id.trim()).filter(Boolean)

    if (ids.length === 0) {
      return res.status(200).json({ contributions: {} })
    }

    // Limit to prevent abuse
    if (ids.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 place IDs per request' })
    }

    // Fetch top contribution for each place
    // Using a subquery to get only the highest-scored contribution per place
    const placeholders = ids.map(() => '?').join(',')

    const sql = `
      SELECT
        c.id,
        c.place_id,
        c.content,
        c.upvotes,
        c.downvotes,
        (c.upvotes - c.downvotes) as score,
        c.created_at,
        u.id as user_id,
        u.username,
        u.display_name,
        u.avatar_url,
        (SELECT COUNT(*) FROM contributions WHERE user_id = u.id AND status IN ('approved', 'pending')) as user_contribution_count,
        (SELECT COALESCE(AVG(upvotes - downvotes), 0) FROM contributions WHERE user_id = u.id AND status IN ('approved', 'pending')) as user_avg_score
      FROM contributions c
      JOIN users u ON c.user_id = u.id
      WHERE c.place_id IN (${placeholders})
        AND (c.status = 'approved' OR c.status = 'pending')
        AND c.contribution_type = 'tip'
      ORDER BY c.place_id, (c.upvotes - c.downvotes) DESC, c.created_at DESC
    `

    const allContributions = await query(sql, ids)

    // Group by place_id and take only the first (highest scored) for each
    const contributionsByPlace = {}
    const seenPlaces = new Set()

    for (const c of allContributions) {
      if (seenPlaces.has(c.place_id)) continue
      seenPlaces.add(c.place_id)

      // Determine if user is a "trusted explorer"
      // Criteria: 5+ contributions with avg score > 2
      const isTrusted = c.user_contribution_count >= 5 && c.user_avg_score > 2

      contributionsByPlace[c.place_id] = {
        id: c.id,
        content: c.content,
        score: c.score,
        createdAt: new Date(c.created_at).toISOString(),
        user: {
          id: c.user_id,
          username: c.username,
          displayName: c.display_name,
          avatarUrl: c.avatar_url,
          isTrusted,
          contributionCount: c.user_contribution_count
        }
      }
    }

    // Fill in nulls for places without contributions
    for (const id of ids) {
      if (!contributionsByPlace[id]) {
        contributionsByPlace[id] = null
      }
    }

    return res.status(200).json({ contributions: contributionsByPlace })
  } catch (error) {
    console.error('Batch contributions error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

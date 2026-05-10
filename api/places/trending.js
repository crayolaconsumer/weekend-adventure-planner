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
    const { limit = 10, days = 30 } = req.query

    // Apply bounds to prevent abuse
    const safeLimit = Math.min(Math.max(1, parseInt(limit) || 10), 50)
    const safeDays = Math.min(Math.max(1, parseInt(days) || 30), 90)

    // Get places with recent activity from any source (contributions, saves,
    // visits). Weighted scoring: contributions are strongest signal (someone
    // wrote about it), visits next (someone went), saves last (someone wants
    // to go). Default window 30 days — short enough to feel current, long
    // enough to populate in low-volume product life.
    const sql = `
      SELECT
        combined.place_id,
        SUM(combined.contribution_score) as contribution_count,
        SUM(combined.save_score) as save_count,
        SUM(combined.visit_score) as visit_count,
        SUM(combined.weight) as popularity_score,
        MAX(combined.activity_at) as last_activity
      FROM (
        SELECT place_id, 1 as contribution_score, 0 as save_score, 0 as visit_score, 3 as weight, created_at as activity_at
        FROM contributions
        WHERE status = 'approved' AND created_at > DATE_SUB(NOW(), INTERVAL ? DAY)
        UNION ALL
        SELECT place_id, 0, 1, 0, 1, saved_at FROM saved_places
        WHERE saved_at > DATE_SUB(NOW(), INTERVAL ? DAY)
        UNION ALL
        SELECT place_id, 0, 0, 1, 2, visited_at FROM visited_places
        WHERE visited_at > DATE_SUB(NOW(), INTERVAL ? DAY)
      ) combined
      GROUP BY combined.place_id
      HAVING popularity_score > 0
      ORDER BY popularity_score DESC, last_activity DESC
      LIMIT ?
    `

    const trending = await query(sql, [safeDays, safeDays, safeDays, safeLimit])

    // Get top contribution content for each trending place
    const placeIds = trending.map(t => t.place_id)

    let contributions = []
    let placeData = []
    let photoByPlace = {}
    if (placeIds.length > 0) {
      const placeholders = placeIds.map(() => '?').join(',')

      // Fetch top tip contributions (used for the card subtitle)
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
          AND c.status = 'approved'
        ORDER BY (c.upvotes - c.downvotes) DESC`,
        placeIds
      )

      // Fetch top user-uploaded photo per place. Real user photos beat
      // Wikipedia thumbnails which beat stylized placeholders. Picks
      // the most-recent approved photo contribution per place.
      const photoRows = await query(
        `SELECT c.place_id, c.metadata, c.created_at
         FROM contributions c
         WHERE c.place_id IN (${placeholders})
           AND c.contribution_type = 'photo'
           AND c.status = 'approved'
         ORDER BY c.created_at DESC`,
        placeIds
      )
      for (const row of photoRows) {
        if (photoByPlace[row.place_id]) continue // most recent first; skip rest
        try {
          const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
          const url = meta?.photoUrl || meta?.url
          if (url) photoByPlace[row.place_id] = url
        } catch {
          // Skip rows with malformed metadata JSON
        }
      }

      // Fetch place data from saved_places OR visited_places — visits write
      // place_data too and might be the only source for a trending place
      // that nobody has saved yet.
      placeData = await query(
        `SELECT place_id, place_data FROM (
          SELECT place_id, place_data, saved_at as activity_at FROM saved_places
          WHERE place_id IN (${placeholders}) AND place_data IS NOT NULL
          UNION ALL
          SELECT place_id, place_data, visited_at as activity_at FROM visited_places
          WHERE place_id IN (${placeholders}) AND place_data IS NOT NULL
        ) all_data
        GROUP BY place_id`,
        [...placeIds, ...placeIds]
      )
    }

    // Group contributions by place
    const contributionsByPlace = {}
    for (const c of contributions) {
      if (!contributionsByPlace[c.place_id]) {
        contributionsByPlace[c.place_id] = c
      }
    }

    // Map place data by place_id
    const placeDataByPlace = {}
    for (const p of placeData) {
      try {
        const data = typeof p.place_data === 'string' ? JSON.parse(p.place_data) : p.place_data
        placeDataByPlace[p.place_id] = data
      } catch {
        // Skip invalid JSON
      }
    }

    const result = trending.map(t => {
      const place = placeDataByPlace[t.place_id]
      // Inject the top user-uploaded photo URL into placeData.image so
      // PlaceImage's resolution chain picks it up first — real human
      // photos take precedence over Wikipedia thumbnails over the
      // stylized placeholder.
      const userPhoto = photoByPlace[t.place_id]
      const placeWithPhoto = (place || userPhoto)
        ? { ...(place || {}), ...(userPhoto ? { image: userPhoto } : {}) }
        : null
      return {
        placeId: t.place_id,
        placeName: place?.name || null,
        placeCategory: place?.category?.label || place?.type || null,
        // Full placeData so the client can render proper imagery
        // (PlaceImage needs the wikipedia/wikidata tags for the
        // Wikipedia thumbnail fallback chain).
        placeData: placeWithPhoto,
        contributionCount: Number(t.contribution_count) || 0,
        saveCount: Number(t.save_count) || 0,
        visitCount: Number(t.visit_count) || 0,
        popularityScore: Number(t.popularity_score) || 0,
        topTip: contributionsByPlace[t.place_id] ? {
          content: contributionsByPlace[t.place_id].content,
          username: contributionsByPlace[t.place_id].username,
          displayName: contributionsByPlace[t.place_id].display_name
        } : null
      }
    })

    // Cache trending at the edge for 10 minutes, with 1-hour stale-while-
    // revalidate. The data is "places trending in last 30 days" — it
    // barely changes minute-to-minute. Edge cache deduplicates the
    // moderately-heavy UNION ALL query across the whole user base.
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600')
    return res.status(200).json({
      trending: result,
      period: `${days} days`
    })
  } catch (error) {
    console.error('Trending places error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

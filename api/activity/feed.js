/**
 * GET /api/activity/feed
 *
 * Unified activity feed that combines:
 * - Visits (visited_places)
 * - Tips (contributions)
 * - Ratings (place_ratings)
 *
 * Returns rich activity data with place context for display in the feed.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { validatePagination, parseCoordinates } from '../lib/validation.js'

// Safe JSON parse helper
const safeJsonParse = (data, defaultValue = null) => {
  if (!data) return defaultValue
  if (typeof data === 'object') return data
  try {
    return JSON.parse(data)
  } catch {
    return defaultValue
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limit: 30 requests per minute for feed
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'activity:feed')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  try {
    const currentUser = await getUserFromRequest(req)
    if (!currentUser) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { limit: queryLimit, offset: queryOffset, type, lat, lng, radius } = req.query
    const { limit, offset } = validatePagination(queryLimit, queryOffset, 20)

    // Parse and validate location parameters for location-aware feed
    let hasLocation = false
    let userLat = null
    let userLng = null
    if (lat && lng) {
      const coordResult = parseCoordinates(lat, lng)
      if (coordResult.valid) {
        hasLocation = true
        userLat = coordResult.lat
        userLng = coordResult.lng
      }
      // Invalid coordinates are silently ignored - feed works without location
    }
    const maxRadius = radius ? Math.min(parseInt(radius, 10), 100000) : 50000 // Default 50km, max 100km

    // Build unified activity feed from multiple sources using UNION ALL
    // Filter by type if specified
    const typeFilter = type && ['visit', 'tip', 'rating', 'photo'].includes(type) ? type : null

    // Get IDs of users the current user follows, excluding blocked users (bidirectional)
    // SECURITY: Filter out users who have blocked the current user OR who the current user has blocked
    const followingResult = await query(`
      SELECT f.following_id
      FROM follows f
      WHERE f.follower_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM blocked_users bu
          WHERE (bu.blocker_id = ? AND bu.blocked_id = f.following_id)
             OR (bu.blocker_id = f.following_id AND bu.blocked_id = ?)
        )
    `, [currentUser.id, currentUser.id, currentUser.id])
    const followingIds = followingResult.map(f => f.following_id)

    if (followingIds.length === 0) {
      return res.status(200).json({
        activities: [],
        hasMore: false,
        total: 0
      })
    }

    // Create placeholders for IN clause
    const placeholders = followingIds.map(() => '?').join(',')

    // Build query parts for each activity type
    const queryParts = []
    const params = []

    // Visits query
    if (!typeFilter || typeFilter === 'visit') {
      // Add distance calculation if location is provided
      const distanceSelect = hasLocation
        ? `, ST_Distance_Sphere(
            POINT(
              CAST(JSON_UNQUOTE(JSON_EXTRACT(vp.place_data, '$.lon')) AS DECIMAL(11,8)),
              CAST(JSON_UNQUOTE(JSON_EXTRACT(vp.place_data, '$.lat')) AS DECIMAL(10,8))
            ),
            POINT(?, ?)
          ) as distance_meters`
        : ', NULL as distance_meters'

      const distanceFilter = hasLocation
        ? `AND vp.place_data IS NOT NULL
           AND JSON_EXTRACT(vp.place_data, '$.lat') IS NOT NULL
           AND JSON_EXTRACT(vp.place_data, '$.lon') IS NOT NULL
           AND ST_Distance_Sphere(
             POINT(
               CAST(JSON_UNQUOTE(JSON_EXTRACT(vp.place_data, '$.lon')) AS DECIMAL(11,8)),
               CAST(JSON_UNQUOTE(JSON_EXTRACT(vp.place_data, '$.lat')) AS DECIMAL(10,8))
             ),
             POINT(?, ?)
           ) <= ?`
        : ''

      // PRIVACY: Only show activities from non-private accounts OR accounts the user follows
      const privacyFilter = `
        AND NOT EXISTS (
          SELECT 1 FROM user_privacy_settings ups
          WHERE ups.user_id = u.id
            AND ups.is_private_account = TRUE
            AND NOT EXISTS (
              SELECT 1 FROM follows
              WHERE follower_id = ? AND following_id = u.id
            )
        )`

      queryParts.push(`
        SELECT
          CONCAT('visit_', vp.id) as id,
          'visit' as activity_type,
          vp.visited_at as created_at,
          vp.place_id,
          vp.place_data,
          vp.rating,
          vp.notes as content,
          NULL as contribution_type,
          0 as upvotes,
          0 as downvotes,
          NULL as metadata,
          u.id as user_id,
          u.username,
          u.display_name,
          u.avatar_url
          ${distanceSelect}
        FROM visited_places vp
        JOIN users u ON vp.user_id = u.id
        WHERE vp.user_id IN (${placeholders})
        ${privacyFilter}
        ${distanceFilter}
      `)
      params.push(...followingIds)
      params.push(currentUser.id) // For privacy filter
      if (hasLocation) {
        params.push(userLng, userLat) // For SELECT distance
        params.push(userLng, userLat, maxRadius) // For WHERE filter
      }
    }

    // Tips/Contributions query
    if (!typeFilter || typeFilter === 'tip' || typeFilter === 'photo') {
      const contribTypeFilter = typeFilter === 'photo'
        ? "AND c.contribution_type = 'photo'"
        : typeFilter === 'tip'
          ? "AND c.contribution_type = 'tip'"
          : ''

      // PRIVACY: Only show activities from non-private accounts OR accounts the user follows
      const privacyFilter = `
        AND NOT EXISTS (
          SELECT 1 FROM user_privacy_settings ups
          WHERE ups.user_id = u.id
            AND ups.is_private_account = TRUE
            AND NOT EXISTS (
              SELECT 1 FROM follows
              WHERE follower_id = ? AND following_id = u.id
            )
        )`

      queryParts.push(`
        SELECT
          CONCAT('contrib_', c.id) as id,
          CASE c.contribution_type
            WHEN 'photo' THEN 'photo'
            ELSE 'tip'
          END as activity_type,
          c.created_at,
          c.place_id,
          NULL as place_data,
          NULL as rating,
          c.content,
          c.contribution_type,
          c.upvotes,
          c.downvotes,
          c.metadata,
          u.id as user_id,
          u.username,
          u.display_name,
          u.avatar_url,
          NULL as distance_meters
        FROM contributions c
        JOIN users u ON c.user_id = u.id
        WHERE c.user_id IN (${placeholders})
        AND c.status = 'approved'
        ${privacyFilter}
        ${contribTypeFilter}
      `)
      params.push(...followingIds)
      params.push(currentUser.id) // For privacy filter
    }

    // Ratings query (only if not filtering by specific type, or if filtering by rating)
    if (!typeFilter || typeFilter === 'rating') {
      // PRIVACY: Only show activities from non-private accounts OR accounts the user follows
      const privacyFilter = `
        AND NOT EXISTS (
          SELECT 1 FROM user_privacy_settings ups
          WHERE ups.user_id = u.id
            AND ups.is_private_account = TRUE
            AND NOT EXISTS (
              SELECT 1 FROM follows
              WHERE follower_id = ? AND following_id = u.id
            )
        )`

      queryParts.push(`
        SELECT
          CONCAT('rating_', pr.id) as id,
          'rating' as activity_type,
          pr.created_at,
          pr.place_id,
          NULL as place_data,
          pr.rating,
          pr.review as content,
          NULL as contribution_type,
          0 as upvotes,
          0 as downvotes,
          NULL as metadata,
          u.id as user_id,
          u.username,
          u.display_name,
          u.avatar_url,
          NULL as distance_meters
        FROM place_ratings pr
        JOIN users u ON pr.user_id = u.id
        WHERE pr.user_id IN (${placeholders})
        ${privacyFilter}
      `)
      params.push(...followingIds)
      params.push(currentUser.id) // For privacy filter
    }

    if (queryParts.length === 0) {
      return res.status(200).json({
        activities: [],
        hasMore: false,
        total: 0
      })
    }

    // Combine with UNION ALL and order by date (or distance if location provided)
    // When location is provided, prioritize nearby activities, then sort by date
    const orderClause = hasLocation
      ? 'ORDER BY CASE WHEN distance_meters IS NOT NULL THEN 0 ELSE 1 END, distance_meters ASC, created_at DESC'
      : 'ORDER BY created_at DESC'

    const sql = `
      SELECT * FROM (
        ${queryParts.join(' UNION ALL ')}
      ) AS combined
      ${orderClause}
      LIMIT ? OFFSET ?
    `
    params.push(limit + 1, offset) // +1 to check if there are more

    const activities = await query(sql, params)

    // Check if there are more results
    const hasMore = activities.length > limit
    if (hasMore) {
      activities.pop() // Remove the extra item
    }

    // Format the activities with place context
    const formattedActivities = activities.map(activity => {
      const placeData = safeJsonParse(activity.place_data)
      const metadata = safeJsonParse(activity.metadata)

      // Extract place info from place_data if available
      const place = placeData ? {
        id: activity.place_id,
        name: placeData.name || null,
        category: placeData.category || null,
        imageUrl: placeData.image || placeData.imageUrl || null,
        address: placeData.address || null
      } : {
        id: activity.place_id,
        name: null,
        category: null,
        imageUrl: null,
        address: null
      }

      return {
        id: activity.id,
        type: activity.activity_type,
        createdAt: activity.created_at,
        place,
        rating: activity.rating,
        content: activity.content,
        contributionType: activity.contribution_type,
        upvotes: activity.upvotes || 0,
        downvotes: activity.downvotes || 0,
        score: (activity.upvotes || 0) - (activity.downvotes || 0),
        metadata,
        distanceMeters: activity.distance_meters,
        user: {
          id: activity.user_id,
          username: activity.username,
          displayName: activity.display_name,
          avatarUrl: activity.avatar_url
        }
      }
    })

    // Get total count for pagination (optional, can be expensive)
    // For now, we'll just indicate hasMore

    return res.status(200).json({
      activities: formattedActivities,
      hasMore
    })
  } catch (error) {
    console.error('Activity feed error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

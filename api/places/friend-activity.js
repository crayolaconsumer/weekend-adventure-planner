/**
 * GET /api/places/friend-activity
 *
 * Batch API to get friend engagement for multiple places.
 * Returns friend saves and visits for each place, respecting privacy settings.
 *
 * Query params:
 * - placeIds: Comma-separated list of place IDs (e.g., "node/123,node/456")
 *
 * Returns:
 * {
 *   "node/123": {
 *     "friendsSaved": [{ id, username, avatarUrl }],
 *     "friendsVisited": [{ id, username, avatarUrl, recommended }],
 *     "friendCount": 2
 *   }
 * }
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { validatePlaceId } from '../lib/validation.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limit: 60 requests per minute (batch reduces overall calls)
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'places:friend-activity')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  try {
    const currentUser = await getUserFromRequest(req)
    if (!currentUser) {
      // Return empty for unauthenticated users (graceful degradation)
      return res.status(200).json({})
    }

    const { placeIds } = req.query
    if (!placeIds) {
      return res.status(400).json({ error: 'placeIds parameter required' })
    }

    // Parse and validate place IDs
    // SECURITY: Validate each ID format to prevent malformed input
    const rawIds = placeIds.split(',').map(id => id.trim()).filter(Boolean)
    const placeIdList = []
    for (const id of rawIds) {
      const result = validatePlaceId(id)
      if (result.valid) {
        placeIdList.push(result.placeId)
      }
      // Invalid IDs are silently skipped
    }

    if (placeIdList.length === 0) {
      return res.status(200).json({})
    }

    // Limit to prevent abuse
    if (placeIdList.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 place IDs per request' })
    }

    // Get users the current user follows (who haven't blocked them)
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
      // User follows nobody - return empty for all places
      const emptyResult = {}
      placeIdList.forEach(placeId => {
        emptyResult[placeId] = {
          friendsSaved: [],
          friendsVisited: [],
          friendCount: 0
        }
      })
      return res.status(200).json(emptyResult)
    }

    // Create placeholders for IN clauses
    const placeIdPlaceholders = placeIdList.map(() => '?').join(',')
    const followingPlaceholders = followingIds.map(() => '?').join(',')

    // Get friends who saved these places (respecting privacy)
    const savedResult = await query(`
      SELECT
        sp.place_id,
        u.id,
        u.username,
        u.avatar_url
      FROM saved_places sp
      JOIN users u ON sp.user_id = u.id
      WHERE sp.place_id IN (${placeIdPlaceholders})
        AND sp.user_id IN (${followingPlaceholders})
        AND NOT EXISTS (
          SELECT 1 FROM user_privacy_settings ups
          WHERE ups.user_id = u.id
            AND ups.is_private_account = TRUE
            AND NOT EXISTS (
              SELECT 1 FROM follows
              WHERE follower_id = ? AND following_id = u.id
            )
        )
      ORDER BY sp.saved_at DESC
    `, [...placeIdList, ...followingIds, currentUser.id])

    // Get friends who visited these places
    const visitedResult = await query(`
      SELECT
        vp.place_id,
        u.id,
        u.username,
        u.avatar_url,
        CASE WHEN vp.rating >= 4 THEN TRUE ELSE FALSE END as recommended
      FROM visited_places vp
      JOIN users u ON vp.user_id = u.id
      WHERE vp.place_id IN (${placeIdPlaceholders})
        AND vp.user_id IN (${followingPlaceholders})
        AND NOT EXISTS (
          SELECT 1 FROM user_privacy_settings ups
          WHERE ups.user_id = u.id
            AND ups.is_private_account = TRUE
            AND NOT EXISTS (
              SELECT 1 FROM follows
              WHERE follower_id = ? AND following_id = u.id
            )
        )
      ORDER BY vp.visited_at DESC
    `, [...placeIdList, ...followingIds, currentUser.id])

    // Build response map
    const result = {}

    // Initialize all place IDs with empty arrays
    placeIdList.forEach(placeId => {
      result[placeId] = {
        friendsSaved: [],
        friendsVisited: [],
        friendCount: 0
      }
    })

    // Track unique friends per place
    const friendsPerPlace = {}
    placeIdList.forEach(placeId => {
      friendsPerPlace[placeId] = new Set()
    })

    // Add saved friends
    savedResult.forEach(row => {
      const placeId = row.place_id
      if (result[placeId]) {
        result[placeId].friendsSaved.push({
          id: row.id,
          username: row.username,
          avatarUrl: row.avatar_url
        })
        friendsPerPlace[placeId].add(row.id)
      }
    })

    // Add visited friends
    visitedResult.forEach(row => {
      const placeId = row.place_id
      if (result[placeId]) {
        result[placeId].friendsVisited.push({
          id: row.id,
          username: row.username,
          avatarUrl: row.avatar_url,
          recommended: Boolean(row.recommended)
        })
        friendsPerPlace[placeId].add(row.id)
      }
    })

    // Calculate friend counts
    placeIdList.forEach(placeId => {
      result[placeId].friendCount = friendsPerPlace[placeId].size
    })

    return res.status(200).json(result)
  } catch (error) {
    console.error('Friend activity error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

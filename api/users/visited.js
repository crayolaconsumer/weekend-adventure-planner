/**
 * GET/POST/DELETE /api/users/visited
 *
 * Manage visited places for authenticated users.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, update, transaction } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

export default async function handler(req, res) {
  // Apply rate limiting before method validation (M2 fix)
  const rateLimit = req.method === 'GET' ? RATE_LIMITS.API_GENERAL : RATE_LIMITS.API_WRITE
  const rateLimitError = applyRateLimit(req, res, rateLimit, 'visited')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res, user)
      case 'POST':
        return await handlePost(req, res, user)
      case 'DELETE':
        return await handleDelete(req, res, user)
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('Visited places error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * GET - Retrieve visited places
 */
async function handleGet(req, res, user) {
  const { limit = 100, offset = 0 } = req.query

  // Validate pagination bounds
  const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 100), 500)
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0)

  const places = await query(
    `SELECT place_id, place_data, visited_at, notes, rating
     FROM visited_places
     WHERE user_id = ?
     ORDER BY visited_at DESC
     LIMIT ? OFFSET ?`,
    [user.id, safeLimit, safeOffset]
  )

  const formatted = places.map(row => ({
    placeId: row.place_id,
    placeData: row.place_data ? (typeof row.place_data === 'string' ? JSON.parse(row.place_data) : row.place_data) : null,
    visitedAt: new Date(row.visited_at).getTime(),
    notes: row.notes,
    rating: row.rating
  }))

  const countResult = await queryOne(
    'SELECT COUNT(*) as total FROM visited_places WHERE user_id = ?',
    [user.id]
  )

  return res.status(200).json({
    visited: formatted,
    visitedIds: formatted.map(v => v.placeId),
    total: countResult.total
  })
}

/**
 * POST - Mark a place as visited
 */
// Maximum JSON data size (10KB)
const MAX_JSON_SIZE = 10 * 1024

async function handlePost(req, res, user) {
  const { placeId, placeData, notes, rating } = req.body

  if (!placeId) {
    return res.status(400).json({ error: 'placeId is required' })
  }

  // Validate JSON size
  if (placeData) {
    const placeDataJson = JSON.stringify(placeData)
    if (placeDataJson.length > MAX_JSON_SIZE) {
      return res.status(400).json({ error: 'Place data too large (max 10KB)' })
    }
  }

  // Check if this is a new visit or update
  const existing = await queryOne(
    'SELECT 1 FROM visited_places WHERE user_id = ? AND place_id = ?',
    [user.id, placeId]
  )
  const isNewVisit = !existing

  // Upsert and update stats atomically
  await transaction(async (conn) => {
    await conn.query(
      `INSERT INTO visited_places (user_id, place_id, place_data, notes, rating)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         place_data = COALESCE(VALUES(place_data), place_data),
         notes = COALESCE(VALUES(notes), notes),
         rating = COALESCE(VALUES(rating), rating),
         visited_at = NOW()`,
      [user.id, placeId, placeData ? JSON.stringify(placeData) : null, notes || null, rating || null]
    )

    // Only increment stats on new visits, not updates
    if (isNewVisit) {
      await conn.query(
        `INSERT INTO user_stats (user_id, places_visited) VALUES (?, 1)
         ON DUPLICATE KEY UPDATE places_visited = places_visited + 1`,
        [user.id]
      )
    }
  })

  return res.status(201).json({ success: true })
}

/**
 * DELETE - Remove visited status
 */
async function handleDelete(req, res, user) {
  const { placeId } = req.query

  if (!placeId) {
    return res.status(400).json({ error: 'placeId query parameter is required' })
  }

  const affected = await update(
    'DELETE FROM visited_places WHERE user_id = ? AND place_id = ?',
    [user.id, placeId]
  )

  return res.status(200).json({ success: true, deleted: affected > 0 })
}

/**
 * GET/POST/DELETE /api/places/saved
 *
 * Manage saved places for authenticated users.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, update } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

const parsePlaceData = (raw, placeId) => {
  if (!raw) return {}

  if (typeof raw === 'object') {
    // Already parsed (JSON column or driver behavior)
    return raw
  }

  let text = raw
  if (raw && raw.constructor?.name === 'Buffer') {
    text = raw.toString('utf8')
  }

  if (typeof text !== 'string') {
    return {}
  }

  try {
    return JSON.parse(text)
  } catch {
    console.warn('Invalid place_data JSON for saved place', placeId)
    return {}
  }
}

export default async function handler(req, res) {
  // Apply rate limiting based on method
  const rateLimit = req.method === 'GET' ? RATE_LIMITS.API_GENERAL : RATE_LIMITS.API_WRITE
  const rateLimitError = applyRateLimit(req, res, rateLimit, 'places:saved')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  // Get authenticated user
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
    console.error('Saved places error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * GET - Retrieve all saved places for user
 */
async function handleGet(req, res, user) {
  const { limit = 100, offset = 0 } = req.query

  // Enforce max limit to prevent resource exhaustion
  const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 100), 100)
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0)

  const places = await query(
    `SELECT place_id, place_data, saved_at, visited, visited_at, notes
     FROM saved_places
     WHERE user_id = ?
     ORDER BY saved_at DESC
     LIMIT ? OFFSET ?`,
    [user.id, safeLimit, safeOffset]
  )

  // Parse place_data JSON and merge with metadata
  const formattedPlaces = places.map(row => ({
    ...parsePlaceData(row.place_data, row.place_id),
    id: row.place_id,
    savedAt: new Date(row.saved_at).getTime(),
    visited: row.visited === 1,
    visitedAt: row.visited_at ? new Date(row.visited_at).getTime() : null,
    notes: row.notes
  }))

  // Get total count
  const countResult = await queryOne(
    'SELECT COUNT(*) as total FROM saved_places WHERE user_id = ?',
    [user.id]
  )

  return res.status(200).json({
    places: formattedPlaces,
    total: countResult.total
  })
}

/**
 * POST - Save a place
 */
// Maximum JSON data size (10KB)
const MAX_JSON_SIZE = 10 * 1024

async function handlePost(req, res, user) {
  const { place } = req.body

  if (!place || !place.id) {
    return res.status(400).json({ error: 'Place with id is required' })
  }

  // Extract place_id and prepare place_data
  const placeId = place.id
  const placeData = { ...place }
  delete placeData.savedAt // Don't store savedAt in place_data, it's a separate column

  // Validate JSON size
  const placeDataJson = JSON.stringify(placeData)
  if (placeDataJson.length > MAX_JSON_SIZE) {
    return res.status(400).json({ error: 'Place data too large (max 10KB)' })
  }

  // Upsert: insert or update if exists
  await query(
    `INSERT INTO saved_places (user_id, place_id, place_data, saved_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       place_data = VALUES(place_data),
       saved_at = VALUES(saved_at)`,
    [user.id, placeId, JSON.stringify(placeData)]
  )

  return res.status(201).json({
    success: true,
    place: {
      ...placeData,
      id: placeId,
      savedAt: Date.now()
    }
  })
}

/**
 * DELETE - Remove a saved place
 */
async function handleDelete(req, res, user) {
  const { placeId } = req.query

  if (!placeId) {
    return res.status(400).json({ error: 'placeId query parameter is required' })
  }

  const affected = await update(
    'DELETE FROM saved_places WHERE user_id = ? AND place_id = ?',
    [user.id, placeId]
  )

  return res.status(200).json({
    success: true,
    deleted: affected > 0
  })
}

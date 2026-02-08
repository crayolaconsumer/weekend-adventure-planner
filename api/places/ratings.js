/**
 * GET/POST/PUT/DELETE /api/places/ratings
 *
 * Manage place ratings for authenticated users.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, insert, update } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { validatePlaceId } from '../lib/validation.js'

export default async function handler(req, res) {
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
      case 'PUT':
        return await handlePut(req, res, user)
      case 'DELETE':
        return await handleDelete(req, res, user)
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('Place ratings error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * GET - Retrieve user's ratings or a specific place rating
 */
async function handleGet(req, res, user) {
  const { placeId, limit = 100, offset = 0 } = req.query

  if (placeId) {
    // Get specific place rating
    const rating = await queryOne(
      'SELECT * FROM place_ratings WHERE user_id = ? AND place_id = ?',
      [user.id, placeId]
    )

    if (!rating) {
      return res.status(404).json({ error: 'Rating not found' })
    }

    return res.status(200).json({
      rating: {
        placeId: rating.place_id,
        rating: rating.rating,
        review: rating.review,
        createdAt: new Date(rating.created_at).getTime(),
        updatedAt: new Date(rating.updated_at).getTime()
      }
    })
  }

  // Get all user's ratings
  const ratings = await query(
    `SELECT * FROM place_ratings
     WHERE user_id = ?
     ORDER BY updated_at DESC
     LIMIT ? OFFSET ?`,
    [user.id, parseInt(limit, 10), parseInt(offset, 10)]
  )

  const countResult = await queryOne(
    'SELECT COUNT(*) as total FROM place_ratings WHERE user_id = ?',
    [user.id]
  )

  return res.status(200).json({
    ratings: ratings.map(r => ({
      placeId: r.place_id,
      rating: r.rating,
      review: r.review,
      createdAt: new Date(r.created_at).getTime(),
      updatedAt: new Date(r.updated_at).getTime()
    })),
    total: countResult.total
  })
}

/**
 * POST - Create or update a rating (UPSERT)
 * This avoids 409 errors by automatically handling existing ratings
 */
async function handlePost(req, res, user) {
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, 'ratings:create')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const { placeId, rating, review } = req.body

  // Validate placeId (OSM-style like "node/12345" or plain numeric)
  const idValidation = validatePlaceId(placeId)
  if (!idValidation.valid) {
    return res.status(400).json({ error: idValidation.message })
  }

  // Validate rating (1-5 or boolean recommend true=5, false=1)
  let normalizedRating
  if (typeof rating === 'boolean') {
    normalizedRating = rating ? 5 : 1
  } else if (typeof rating === 'number' && rating >= 1 && rating <= 5) {
    normalizedRating = Math.floor(rating)
  } else {
    return res.status(400).json({ error: 'Rating must be 1-5 or boolean' })
  }

  // Validate review
  const sanitizedReview = review ? String(review).slice(0, 500) : null

  // Check if this is a new rating (for stats update)
  const existing = await queryOne(
    'SELECT id FROM place_ratings WHERE user_id = ? AND place_id = ?',
    [user.id, placeId]
  )
  const isNew = !existing

  // UPSERT: Insert or update on duplicate key
  await query(
    `INSERT INTO place_ratings (user_id, place_id, rating, review)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE rating = VALUES(rating), review = VALUES(review), updated_at = NOW()`,
    [user.id, placeId, normalizedRating, sanitizedReview]
  )

  // Only update stats for new ratings
  if (isNew) {
    await query(
      `INSERT INTO user_stats (user_id, places_rated) VALUES (?, 1)
       ON DUPLICATE KEY UPDATE places_rated = places_rated + 1`,
      [user.id]
    )
  }

  return res.status(isNew ? 201 : 200).json({ success: true, created: isNew })
}

/**
 * PUT - Update an existing rating
 */
async function handlePut(req, res, user) {
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, 'ratings:update')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const { placeId, rating, review } = req.body

  // Validate placeId (OSM-style like "node/12345" or plain numeric)
  const idValidation = validatePlaceId(placeId)
  if (!idValidation.valid) {
    return res.status(400).json({ error: idValidation.message })
  }

  const updates = []
  const params = []

  if (rating !== undefined) {
    let normalizedRating
    if (typeof rating === 'boolean') {
      normalizedRating = rating ? 5 : 1
    } else if (typeof rating === 'number' && rating >= 1 && rating <= 5) {
      normalizedRating = Math.floor(rating)
    } else {
      return res.status(400).json({ error: 'Rating must be 1-5 or boolean' })
    }
    updates.push('rating = ?')
    params.push(normalizedRating)
  }

  if (review !== undefined) {
    updates.push('review = ?')
    params.push(review ? String(review).slice(0, 500) : null)
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' })
  }

  params.push(user.id, placeId)

  const affected = await update(
    `UPDATE place_ratings SET ${updates.join(', ')} WHERE user_id = ? AND place_id = ?`,
    params
  )

  if (affected === 0) {
    return res.status(404).json({ error: 'Rating not found' })
  }

  return res.status(200).json({ success: true })
}

/**
 * DELETE - Delete a rating
 */
async function handleDelete(req, res, user) {
  const { placeId } = req.query

  if (!placeId) {
    return res.status(400).json({ error: 'placeId query parameter required' })
  }

  const affected = await update(
    'DELETE FROM place_ratings WHERE user_id = ? AND place_id = ?',
    [user.id, placeId]
  )

  return res.status(200).json({ success: true, deleted: affected > 0 })
}

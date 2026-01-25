/**
 * GET/POST /api/places/swiped
 *
 * Track swiped places (likes and skips) for authenticated users.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, insert } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

export default async function handler(req, res) {
  // Apply rate limiting
  const rateLimit = req.method === 'GET' ? RATE_LIMITS.API_GENERAL : RATE_LIMITS.API_WRITE
  const rateLimitError = applyRateLimit(req, res, rateLimit, 'places:swiped')
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
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('Swiped places error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * GET - Retrieve swiped places
 * Query params:
 *   - action: 'like' | 'skip' | undefined (all)
 *   - limit: number (default 500)
 */
async function handleGet(req, res, user) {
  const { action, limit = 500 } = req.query

  // Enforce max limit to prevent resource exhaustion
  const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 500), 500)

  let sql = `SELECT place_id, action, swiped_at
             FROM swiped_places
             WHERE user_id = ?`
  const params = [user.id]

  if (action === 'like' || action === 'skip') {
    sql += ' AND action = ?'
    params.push(action)
  }

  sql += ' ORDER BY swiped_at DESC LIMIT ?'
  params.push(safeLimit)

  const swiped = await query(sql, params)

  // Group by action for convenience
  const likes = []
  const skips = []

  swiped.forEach(row => {
    const item = {
      placeId: row.place_id,
      swipedAt: new Date(row.swiped_at).getTime()
    }
    if (row.action === 'like') {
      likes.push(item)
    } else {
      skips.push(item)
    }
  })

  return res.status(200).json({
    likes,
    skips,
    // Also return flat list of IDs for quick lookup
    likedIds: likes.map(l => l.placeId),
    skippedIds: skips.map(s => s.placeId)
  })
}

/**
 * POST - Record a swipe
 * Body: { placeId, action: 'like' | 'skip' }
 */
async function handlePost(req, res, user) {
  const { placeId, action } = req.body

  if (!placeId) {
    return res.status(400).json({ error: 'placeId is required' })
  }

  if (action !== 'like' && action !== 'skip') {
    return res.status(400).json({ error: 'action must be "like" or "skip"' })
  }

  // Check if already swiped
  const existing = await queryOne(
    'SELECT id, action FROM swiped_places WHERE user_id = ? AND place_id = ?',
    [user.id, placeId]
  )

  if (existing) {
    // Update if action changed
    if (existing.action !== action) {
      await query(
        'UPDATE swiped_places SET action = ?, swiped_at = NOW() WHERE id = ?',
        [action, existing.id]
      )
    }
    return res.status(200).json({ success: true, updated: existing.action !== action })
  }

  await insert(
    'INSERT INTO swiped_places (user_id, place_id, action) VALUES (?, ?, ?)',
    [user.id, placeId, action]
  )

  return res.status(201).json({ success: true })
}

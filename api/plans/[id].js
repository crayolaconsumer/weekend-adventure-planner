/**
 * GET/PUT/DELETE /api/plans/:id
 *
 * Single plan operations
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, update, transaction } from '../lib/db.js'
import { validateId } from '../lib/validation.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

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
  // Apply rate limiting (stricter for write operations)
  const rateLimit = req.method === 'GET' ? RATE_LIMITS.API_GENERAL : RATE_LIMITS.API_WRITE
  const rateLimitError = applyRateLimit(req, res, rateLimit, 'plans:id')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const { id } = req.query

  // Validate plan ID format
  const idValidation = validateId(id)
  if (!idValidation.valid) {
    return res.status(400).json({ error: 'Invalid plan ID' })
  }
  const planId = idValidation.id

  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res, planId)
      case 'PUT':
        return await handlePut(req, res, planId)
      case 'DELETE':
        return await handleDelete(req, res, planId)
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('Plan error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * GET - Get plan details with stops
 */
async function handleGet(req, res, id) {
  const user = await getUserFromRequest(req)

  // Get plan
  const plan = await queryOne(
    `SELECT
      p.*,
      u.username,
      u.display_name,
      u.avatar_url
    FROM plans p
    JOIN users u ON p.user_id = u.id
    WHERE p.id = ?`,
    [id]
  )

  if (!plan) {
    return res.status(404).json({ error: 'Plan not found' })
  }

  // Check access: must be owner or plan must be public
  const isOwner = user && user.id === plan.user_id
  if (!isOwner && !plan.is_public) {
    return res.status(403).json({ error: 'Plan is private' })
  }

  // Get stops
  const stops = await query(
    `SELECT * FROM plan_stops WHERE plan_id = ? ORDER BY sort_order ASC`,
    [id]
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
      isPublic: Boolean(plan.is_public),
      createdAt: new Date(plan.created_at).toISOString(),
      isOwner,
      user: {
        username: plan.username,
        displayName: plan.display_name,
        avatarUrl: plan.avatar_url
      },
      stops: formattedStops
    }
  })
}

/**
 * PUT - Update plan (title, public status, reorder stops)
 * Body: { title?, isPublic?, stops?: [{ placeId, placeData, scheduledTime, durationMinutes }] }
 */
async function handlePut(req, res, id) {
  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  // Check ownership
  const plan = await queryOne('SELECT user_id FROM plans WHERE id = ?', [id])
  if (!plan) {
    return res.status(404).json({ error: 'Plan not found' })
  }
  if (plan.user_id !== user.id) {
    return res.status(403).json({ error: 'Not authorized' })
  }

  const { title, isPublic, stops } = req.body

  // Update plan metadata
  if (title !== undefined || isPublic !== undefined) {
    const updates = []
    const params = []

    if (title !== undefined) {
      updates.push('title = ?')
      params.push(title)
    }
    if (isPublic !== undefined) {
      updates.push('is_public = ?')
      params.push(isPublic ? 1 : 0)
    }

    if (updates.length > 0) {
      params.push(id)
      await update(`UPDATE plans SET ${updates.join(', ')} WHERE id = ?`, params)
    }
  }

  // Update stops if provided (replace all) - atomic operation
  if (stops && Array.isArray(stops)) {
    await transaction(async (conn) => {
      // Delete existing stops
      await conn.query('DELETE FROM plan_stops WHERE plan_id = ?', [id])

      // Insert new stops
      for (let i = 0; i < stops.length; i++) {
        const stop = stops[i]
        await conn.query(
          `INSERT INTO plan_stops (plan_id, place_id, place_data, sort_order, scheduled_time, duration_minutes)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            id,
            stop.placeId || stop.id,
            JSON.stringify(stop.placeData || stop),
            i + 1,
            stop.scheduledTime || null,
            stop.durationMinutes || stop.duration || 60
          ]
        )
      }
    })
  }

  return res.status(200).json({ success: true })
}

/**
 * DELETE - Delete a plan
 */
async function handleDelete(req, res, id) {
  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  // Check ownership
  const plan = await queryOne('SELECT user_id FROM plans WHERE id = ?', [id])
  if (!plan) {
    return res.status(404).json({ error: 'Plan not found' })
  }
  if (plan.user_id !== user.id) {
    return res.status(403).json({ error: 'Not authorized' })
  }

  // Delete plan (cascade deletes stops)
  await update('DELETE FROM plans WHERE id = ?', [id])

  return res.status(200).json({ success: true })
}

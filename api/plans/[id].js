/**
 * GET/PUT/DELETE /api/plans/:id
 *
 * Single plan operations
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, update } from '../lib/db.js'

export default async function handler(req, res) {
  const { id } = req.query

  if (!id) {
    return res.status(400).json({ error: 'Plan ID required' })
  }

  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res, id)
      case 'PUT':
        return await handlePut(req, res, id)
      case 'DELETE':
        return await handleDelete(req, res, id)
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
    placeData: JSON.parse(s.place_data),
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

  // Update stops if provided (replace all)
  if (stops && Array.isArray(stops)) {
    // Delete existing stops
    await update('DELETE FROM plan_stops WHERE plan_id = ?', [id])

    // Insert new stops
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i]
      await query(
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

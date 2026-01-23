/**
 * GET/POST /api/plans
 *
 * Manage adventure plans
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, insert } from '../lib/db.js'

/**
 * Generate a unique share code
 */
function generateShareCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let code = ''
  for (let i = 0; i < 12; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export default async function handler(req, res) {
  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res)
      case 'POST':
        return await handlePost(req, res)
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('Plans error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * GET - List user's plans
 * Query params:
 *   - limit: Max results (default 20)
 */
async function handleGet(req, res) {
  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  const { limit = 20 } = req.query

  const plans = await query(
    `SELECT
      p.id,
      p.share_code,
      p.title,
      p.vibe,
      p.duration_hours,
      p.is_public,
      p.created_at,
      COUNT(ps.id) as stop_count
    FROM plans p
    LEFT JOIN plan_stops ps ON p.id = ps.plan_id
    WHERE p.user_id = ?
    GROUP BY p.id
    ORDER BY p.created_at DESC
    LIMIT ?`,
    [user.id, parseInt(limit, 10)]
  )

  const formatted = plans.map(p => ({
    id: p.id,
    shareCode: p.share_code,
    title: p.title,
    vibe: p.vibe,
    durationHours: p.duration_hours,
    isPublic: Boolean(p.is_public),
    stopCount: p.stop_count,
    createdAt: new Date(p.created_at).toISOString()
  }))

  return res.status(200).json({ plans: formatted })
}

/**
 * POST - Create a new plan
 * Body: { title, vibe, durationHours, stops: [{ placeId, placeData, scheduledTime, durationMinutes }] }
 */
async function handlePost(req, res) {
  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  const { title, vibe, durationHours, stops, isPublic = false } = req.body

  // Validate required fields
  if (!title || !vibe || !durationHours) {
    return res.status(400).json({ error: 'title, vibe, and durationHours are required' })
  }

  if (!stops || !Array.isArray(stops) || stops.length === 0) {
    return res.status(400).json({ error: 'At least one stop is required' })
  }

  // Generate unique share code
  let shareCode = generateShareCode()
  let attempts = 0
  while (attempts < 5) {
    const existing = await queryOne('SELECT id FROM plans WHERE share_code = ?', [shareCode])
    if (!existing) break
    shareCode = generateShareCode()
    attempts++
  }

  // Create plan
  const planId = await insert(
    `INSERT INTO plans (user_id, share_code, title, vibe, duration_hours, is_public)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [user.id, shareCode, title, vibe, durationHours, isPublic ? 1 : 0]
  )

  // Insert stops
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]
    await insert(
      `INSERT INTO plan_stops (plan_id, place_id, place_data, sort_order, scheduled_time, duration_minutes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        planId,
        stop.placeId || stop.id,
        JSON.stringify(stop.placeData || stop),
        i + 1,
        stop.scheduledTime || null,
        stop.durationMinutes || stop.duration || 60
      ]
    )
  }

  return res.status(201).json({
    success: true,
    plan: {
      id: planId,
      shareCode,
      title,
      vibe,
      durationHours,
      isPublic,
      stopCount: stops.length,
      createdAt: new Date().toISOString()
    }
  })
}

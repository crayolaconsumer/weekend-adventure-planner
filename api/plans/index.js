/**
 * GET/POST /api/plans
 *
 * Manage adventure plans
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, insert } from '../lib/db.js'
import { generateShareCode } from '../lib/crypto.js'
import { validatePlanTitle, validatePagination } from '../lib/validation.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

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

  const { limit: queryLimit } = req.query
  const { limit } = validatePagination(queryLimit, 0, 50)

  const plans = await query(
    `SELECT
      p.id,
      p.share_code,
      p.title,
      p.vibe,
      p.duration_hours,
      p.default_transport,
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
    defaultTransport: p.default_transport || 'walk',
    isPublic: Boolean(p.is_public),
    stopCount: p.stop_count,
    createdAt: new Date(p.created_at).toISOString()
  }))

  return res.status(200).json({ plans: formatted })
}

/**
 * POST - Create a new plan
 * Body: {
 *   title, vibe, durationHours, defaultTransport,
 *   stops: [{ placeId, placeData, scheduledTime, durationMinutes, transportToNext, travelTimeToNext }]
 * }
 */
async function handlePost(req, res) {
  // Rate limit plan creation
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, 'plans:create')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  const { title, vibe, durationHours, defaultTransport = 'walk', stops, isPublic = false } = req.body

  // Validate title
  const titleValidation = validatePlanTitle(title)
  if (!titleValidation.valid) {
    return res.status(400).json({ error: titleValidation.message })
  }

  // Validate required fields
  if (!vibe || !durationHours) {
    return res.status(400).json({ error: 'vibe and durationHours are required' })
  }

  // Validate vibe
  const validVibes = ['chill', 'adventure', 'romantic', 'family', 'cultural', 'foodie', 'mix']
  if (!validVibes.includes(vibe)) {
    return res.status(400).json({ error: 'Invalid vibe' })
  }

  // Validate durationHours
  const hours = parseFloat(durationHours)
  if (isNaN(hours) || hours < 0.5 || hours > 24) {
    return res.status(400).json({ error: 'durationHours must be between 0.5 and 24' })
  }

  if (!stops || !Array.isArray(stops) || stops.length === 0) {
    return res.status(400).json({ error: 'At least one stop is required' })
  }

  if (stops.length > 20) {
    return res.status(400).json({ error: 'Maximum 20 stops allowed' })
  }

  // Validate stop data sizes (10KB max per stop)
  const MAX_JSON_SIZE = 10 * 1024
  for (const stop of stops) {
    const stopData = stop.placeData || stop
    const stopDataJson = JSON.stringify(stopData)
    if (stopDataJson.length > MAX_JSON_SIZE) {
      return res.status(400).json({ error: 'Stop data too large (max 10KB per stop)' })
    }
  }

  // Validate transport mode
  const validModes = ['walk', 'transit', 'drive']
  if (!validModes.includes(defaultTransport)) {
    return res.status(400).json({ error: 'defaultTransport must be walk, transit, or drive' })
  }

  // Generate unique share code with cryptographically secure generator
  // 16 chars with 36^16 possibilities - effectively impossible to collide
  let shareCode = generateShareCode()
  let attempts = 0
  while (attempts < 10) {
    const existing = await queryOne('SELECT id FROM plans WHERE share_code = ?', [shareCode])
    if (!existing) break
    shareCode = generateShareCode()
    attempts++
  }

  if (attempts >= 10) {
    console.error('Failed to generate unique share code after 10 attempts')
    return res.status(500).json({ error: 'Failed to create plan. Please try again.' })
  }

  // Create plan
  const planId = await insert(
    `INSERT INTO plans (user_id, share_code, title, vibe, duration_hours, default_transport, is_public)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [user.id, shareCode, title, vibe, durationHours, defaultTransport, isPublic ? 1 : 0]
  )

  // Insert stops
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]
    const transportToNext = validModes.includes(stop.transportToNext) ? stop.transportToNext : defaultTransport
    await insert(
      `INSERT INTO plan_stops (plan_id, place_id, place_data, sort_order, scheduled_time, duration_minutes, transport_to_next, travel_time_to_next)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        planId,
        stop.placeId || stop.id,
        JSON.stringify(stop.placeData || stop),
        i + 1,
        stop.scheduledTime || null,
        stop.durationMinutes || stop.duration || 60,
        transportToNext,
        stop.travelTimeToNext || null
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
      defaultTransport,
      isPublic,
      stopCount: stops.length,
      createdAt: new Date().toISOString()
    }
  })
}

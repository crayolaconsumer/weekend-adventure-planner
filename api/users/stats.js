/**
 * GET/PUT /api/users/stats
 *
 * Manage user statistics for authenticated users.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

// Maximum value to prevent integer overflow (MySQL INT max is 2147483647)
const MAX_STAT_VALUE = 999999999

export default async function handler(req, res) {
  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res, user)
      case 'PUT':
        return await handlePut(req, res, user)
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('User stats error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * GET - Retrieve user stats
 */
async function handleGet(req, res, user) {
  let stats = await queryOne(
    'SELECT * FROM user_stats WHERE user_id = ?',
    [user.id]
  )

  // Create default stats if none exist
  if (!stats) {
    await query('INSERT INTO user_stats (user_id) VALUES (?)', [user.id])
    stats = await queryOne('SELECT * FROM user_stats WHERE user_id = ?', [user.id])
  }

  return res.status(200).json({
    stats: {
      placesViewed: stats.places_viewed,
      placesSaved: stats.places_saved,
      placesVisited: stats.places_visited,
      placesRated: stats.places_rated,
      eventsViewed: stats.events_viewed,
      eventsSaved: stats.events_saved,
      totalSwipes: stats.total_swipes,
      swipesRight: stats.swipes_right,
      swipesLeft: stats.swipes_left,
      plansCreated: stats.plans_created,
      plansShared: stats.plans_shared,
      contributionsMade: stats.contributions_made
    }
  })
}

/**
 * PUT - Update/increment user stats
 * Body can include any stat field with a number to SET,
 * or use { increment: { field: amount } } to increment
 */
async function handlePut(req, res, user) {
  // Rate limit stat updates
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'stats:update')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const { increment, ...directUpdates } = req.body

  // Ensure stats row exists with atomic INSERT IGNORE
  await query('INSERT IGNORE INTO user_stats (user_id) VALUES (?)', [user.id])

  const updates = []
  const params = []

  // Whitelist of allowed fields
  const fieldMap = {
    placesViewed: 'places_viewed',
    placesSaved: 'places_saved',
    placesVisited: 'places_visited',
    placesRated: 'places_rated',
    eventsViewed: 'events_viewed',
    eventsSaved: 'events_saved',
    totalSwipes: 'total_swipes',
    swipesRight: 'swipes_right',
    swipesLeft: 'swipes_left',
    plansCreated: 'plans_created',
    plansShared: 'plans_shared',
    contributionsMade: 'contributions_made'
  }

  // Handle increments with overflow protection
  if (increment && typeof increment === 'object') {
    for (const [key, amount] of Object.entries(increment)) {
      const dbField = fieldMap[key]
      if (dbField && typeof amount === 'number') {
        // Validate increment amount (positive only, max 100 per request)
        const safeAmount = Math.min(Math.max(0, Math.floor(amount)), 100)
        if (safeAmount > 0) {
          // Use LEAST to cap at MAX_STAT_VALUE to prevent overflow
          updates.push(`${dbField} = LEAST(${dbField} + ?, ${MAX_STAT_VALUE})`)
          params.push(safeAmount)
        }
      }
    }
  }

  // Handle direct updates with overflow protection
  for (const [key, value] of Object.entries(directUpdates)) {
    const dbField = fieldMap[key]
    if (dbField && typeof value === 'number') {
      // Validate direct value (non-negative, capped)
      const safeValue = Math.min(Math.max(0, Math.floor(value)), MAX_STAT_VALUE)
      updates.push(`${dbField} = ?`)
      params.push(safeValue)
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid stats to update' })
  }

  params.push(user.id)

  await query(
    `UPDATE user_stats SET ${updates.join(', ')} WHERE user_id = ?`,
    params
  )

  return res.status(200).json({ success: true })
}

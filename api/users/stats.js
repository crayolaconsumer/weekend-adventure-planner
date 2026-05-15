/**
 * GET/PUT /api/users/stats
 *
 * Manage user statistics for authenticated users.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'
import { evaluateBadges } from './badges.js'
import { waitUntil } from '@vercel/functions'

// Maximum value to prevent integer overflow (MySQL INT max is 2147483647)
const MAX_STAT_VALUE = 999999999

async function handler(req, res) {
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
      contributionsMade: stats.contributions_made,
      // Activity + streak fields. Moved off localStorage so they
      // persist across devices. lastStreakDate / lastActivityAt are
      // returned as ISO strings; the client converts to Date as needed.
      timesWentOut: stats.times_went_out,
      boredomBusts: stats.boredom_busts,
      currentStreak: stats.current_streak,
      bestStreak: stats.best_streak,
      lastStreakDate: stats.last_streak_date ? new Date(stats.last_streak_date).toISOString() : null,
      lastActivityAt: stats.last_activity_at ? new Date(stats.last_activity_at).toISOString() : null
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

  // Whitelist of allowed fields. New activity + streak fields live
  // alongside the existing counters. Numeric fields all share the same
  // overflow protection; lastStreakDate / lastActivityAt are date-type
  // and handled in a separate branch below.
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
    contributionsMade: 'contributions_made',
    timesWentOut: 'times_went_out',
    boredomBusts: 'boredom_busts',
    currentStreak: 'current_streak',
    bestStreak: 'best_streak'
  }

  // Date fields — handled separately since they're strings, not ints.
  // Accept ISO date string or null (to clear).
  const dateFieldMap = {
    lastStreakDate: 'last_streak_date',
    lastActivityAt: 'last_activity_at'
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

  // Handle direct numeric updates with overflow protection
  for (const [key, value] of Object.entries(directUpdates)) {
    const dbField = fieldMap[key]
    if (dbField && typeof value === 'number') {
      // Validate direct value (non-negative, capped)
      const safeValue = Math.min(Math.max(0, Math.floor(value)), MAX_STAT_VALUE)
      updates.push(`${dbField} = ?`)
      params.push(safeValue)
    }
  }

  // Handle date updates. Strings get parsed to Date; null clears.
  for (const [key, value] of Object.entries(directUpdates)) {
    const dbField = dateFieldMap[key]
    if (!dbField) continue
    if (value === null) {
      updates.push(`${dbField} = NULL`)
    } else if (typeof value === 'string') {
      const parsed = new Date(value)
      if (!Number.isNaN(parsed.getTime())) {
        updates.push(`${dbField} = ?`)
        // For DATE columns, MySQL accepts YYYY-MM-DD; for TIMESTAMP
        // it accepts ISO. mysql2 will coerce either correctly.
        params.push(parsed)
      }
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

  // Re-evaluate ALL stats-derived badges after every stats write.
  // evaluateBadges queries source-of-truth tables for activity counts
  // and uses user_stats for streak / boredom-busts. Idempotent.
  // waitUntil so badge inserts complete even after the response is
  // sent (see the corresponding fix in api/social/index.js).
  waitUntil(
    evaluateBadges(user.id).catch(err =>
      console.error('[badges] evaluateBadges failed', {
        userId: user.id,
        err: err?.message || String(err)
      })
    )
  )

  return res.status(200).json({ success: true })
}

export default withCors(handler)

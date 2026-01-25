/**
 * GET/POST /api/users/notification-preferences
 *
 * Manage user notification preferences
 */

import { getUserFromRequest } from '../lib/auth.js'
import { queryOne, query } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

export default async function handler(req, res) {
  const rateLimit = req.method === 'GET' ? RATE_LIMITS.API_GENERAL : RATE_LIMITS.API_WRITE
  const rateLimitError = applyRateLimit(req, res, rateLimit, 'notification-prefs')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  try {
    if (req.method === 'GET') {
      return await getPreferences(res, user)
    } else if (req.method === 'POST') {
      return await updatePreferences(req, res, user)
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error('Notification preferences error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function getPreferences(res, user) {
  let prefs = await queryOne(
    'SELECT * FROM notification_preferences WHERE user_id = ?',
    [user.id]
  )

  if (!prefs) {
    // Create default preferences (all enabled)
    await query(
      'INSERT INTO notification_preferences (user_id) VALUES (?)',
      [user.id]
    )
    prefs = await queryOne(
      'SELECT * FROM notification_preferences WHERE user_id = ?',
      [user.id]
    )
  }

  return res.status(200).json({
    preferences: {
      newContribution: !!prefs.new_contribution,
      newFollower: !!prefs.new_follower,
      planShared: !!prefs.plan_shared,
      weeklyDigest: !!prefs.weekly_digest
    }
  })
}

async function updatePreferences(req, res, user) {
  const { newContribution, newFollower, planShared, weeklyDigest } = req.body

  // Build update query dynamically based on provided fields
  const updates = []
  const values = []

  if (typeof newContribution === 'boolean') {
    updates.push('new_contribution = ?')
    values.push(newContribution ? 1 : 0)
  }
  if (typeof newFollower === 'boolean') {
    updates.push('new_follower = ?')
    values.push(newFollower ? 1 : 0)
  }
  if (typeof planShared === 'boolean') {
    updates.push('plan_shared = ?')
    values.push(planShared ? 1 : 0)
  }
  if (typeof weeklyDigest === 'boolean') {
    updates.push('weekly_digest = ?')
    values.push(weeklyDigest ? 1 : 0)
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid preferences to update' })
  }

  // Ensure row exists first (upsert pattern)
  await query(
    'INSERT IGNORE INTO notification_preferences (user_id) VALUES (?)',
    [user.id]
  )

  // Update preferences
  values.push(user.id)
  await query(
    `UPDATE notification_preferences SET ${updates.join(', ')} WHERE user_id = ?`,
    values
  )

  // Return updated preferences
  return getPreferences(res, user)
}

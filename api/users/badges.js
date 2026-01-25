/**
 * GET /api/users/badges
 *
 * Retrieve user badges for authenticated users.
 * Note: Badge awarding is handled server-side only via awardBadge()
 * to prevent users from self-awarding badges.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

export default async function handler(req, res) {
  // Apply rate limiting
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'users:badges')
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
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('User badges error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * GET - Retrieve user's earned badges
 */
async function handleGet(req, res, user) {
  const badges = await query(
    'SELECT badge_id, earned_at FROM user_badges WHERE user_id = ? ORDER BY earned_at DESC',
    [user.id]
  )

  return res.status(200).json({
    badges: badges.map(b => ({
      badgeId: b.badge_id,
      earnedAt: new Date(b.earned_at).getTime()
    })),
    badgeIds: badges.map(b => b.badge_id)
  })
}

/**
 * Server-side function to award a badge (not exposed via API)
 * Call this from other server code when badge criteria are met.
 * @param {number} userId - User to award badge to
 * @param {string} badgeId - Badge identifier
 * @returns {Promise<{awarded: boolean, alreadyEarned: boolean}>}
 */
export async function awardBadge(userId, badgeId) {
  if (!userId || !badgeId) {
    return { awarded: false, alreadyEarned: false }
  }

  // Check if already earned
  const existing = await queryOne(
    'SELECT id FROM user_badges WHERE user_id = ? AND badge_id = ?',
    [userId, badgeId]
  )

  if (existing) {
    return { awarded: false, alreadyEarned: true }
  }

  await query(
    'INSERT INTO user_badges (user_id, badge_id) VALUES (?, ?)',
    [userId, badgeId]
  )

  return { awarded: true, alreadyEarned: false }
}

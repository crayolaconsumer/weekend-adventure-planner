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
import { withCors } from '../lib/cors.js'

async function handler(req, res) {
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

/**
 * Re-evaluate every stats-derived badge for a user. Idempotent —
 * awardBadge checks for existing rows before inserting, so this is
 * safe to run after every relevant event.
 *
 * Source-of-truth tables (saved_places, plans, visited_places,
 * contributions) are queried directly rather than trusting the
 * user_stats cached counters — those have historically drifted from
 * the underlying rows. Streak + boredom-bust + activity-flag badges
 * come from user_stats because they're not derivable from any row
 * table.
 *
 * Call after: stats PUT, saved-place INSERT, plan create, visit
 * INSERT, contribution INSERT, vote on contribution, new follower.
 */
export async function evaluateBadges(userId) {
  if (!userId) return

  const [stats, savedCount, planCount, visitedCount, contribCount, followerCount, helpfulSum] = await Promise.all([
    queryOne(
      `SELECT current_streak, best_streak, boredom_busts FROM user_stats WHERE user_id = ?`,
      [userId]
    ),
    queryOne(`SELECT COUNT(*) AS n FROM saved_places WHERE user_id = ?`, [userId]),
    queryOne(`SELECT COUNT(*) AS n FROM plans WHERE user_id = ?`, [userId]),
    queryOne(`SELECT COUNT(*) AS n FROM visited_places WHERE user_id = ?`, [userId]),
    queryOne(
      `SELECT COUNT(*) AS n FROM contributions WHERE user_id = ? AND status = 'approved'`,
      [userId]
    ),
    queryOne(`SELECT COUNT(*) AS n FROM follows WHERE following_id = ?`, [userId]),
    queryOne(
      `SELECT COALESCE(SUM(upvotes), 0) AS n FROM contributions WHERE user_id = ? AND status = 'approved'`,
      [userId]
    ),
  ])

  const cs = stats?.current_streak || 0
  const bs = stats?.best_streak || 0
  const bb = stats?.boredom_busts || 0
  const saved = savedCount?.n || 0
  const plans = planCount?.n || 0
  const visited = visitedCount?.n || 0
  const contribs = contribCount?.n || 0
  const followers = followerCount?.n || 0
  const helpful = Number(helpfulSum?.n) || 0

  // Streak badges. Best-streak floors so a user who once hit 7 days
  // still owns streak_7 after their streak resets to 0.
  const awards = []
  if (cs >= 3 || bs >= 3) awards.push('streak_3')
  if (cs >= 7 || bs >= 7) awards.push('streak_7')
  if (cs >= 30 || bs >= 30) awards.push('streak_30')

  // Activity flag badges (single-action)
  if (visited >= 1) awards.push('first_visit')
  if (visited >= 10) awards.push('visits_10')
  if (visited >= 50) awards.push('visits_50')
  if (visited >= 100) awards.push('visits_100')

  if (contribs >= 1) awards.push('first_contribution')
  if (contribs >= 10) awards.push('contributor_10')
  if (contribs >= 50) awards.push('contributor_50')

  if (followers >= 10) awards.push('followers_10')
  if (followers >= 100) awards.push('followers_100')

  if (bb >= 10) awards.push('just_go')
  if (saved >= 20) awards.push('curator')
  if (plans >= 5) awards.push('planner')

  // Helpful-vote-based badges (currently no client equivalent — added
  // here so server is the single source of truth for everything the
  // user can earn).
  if (helpful >= 10) awards.push('helpful_10')
  if (helpful >= 50) awards.push('helpful_50')

  // Award all in parallel. awardBadge is idempotent so duplicates are
  // cheap no-ops.
  await Promise.all(awards.map(badgeId => awardBadge(userId, badgeId)))
}

export default withCors(handler)

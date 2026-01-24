/**
 * GET/POST /api/social
 *
 * Social features: follows, activity feed, user discovery
 *
 * GET actions (via ?action=xxx):
 *   - followers: Get user's followers
 *   - following: Get who user follows
 *   - feed: Get activity feed from followed users
 *   - discover: Get recommended users ("People Like You")
 *
 * POST actions:
 *   - follow: Follow a user
 *   - unfollow: Unfollow a user
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, insert, update } from '../lib/db.js'
import { createNotification } from '../notifications/index.js'

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
    console.error('Social API error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * GET - Fetch social data
 */
async function handleGet(req, res) {
  const { action, userId, limit = 20, offset = 0 } = req.query
  const currentUser = await getUserFromRequest(req)

  switch (action) {
    case 'followers':
      return await getFollowers(req, res, userId, currentUser, parseInt(limit), parseInt(offset))
    case 'following':
      return await getFollowing(req, res, userId, currentUser, parseInt(limit), parseInt(offset))
    case 'feed':
      return await getActivityFeed(req, res, currentUser, parseInt(limit), parseInt(offset))
    case 'discover':
      return await discoverUsers(req, res, currentUser, parseInt(limit))
    default:
      return res.status(400).json({ error: 'Invalid action. Use: followers, following, feed, or discover' })
  }
}

/**
 * POST - Social actions
 */
async function handlePost(req, res) {
  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  const { action } = req.body

  switch (action) {
    case 'follow':
      return await followUser(req, res, user)
    case 'unfollow':
      return await unfollowUser(req, res, user)
    default:
      return res.status(400).json({ error: 'Invalid action. Use: follow or unfollow' })
  }
}

/**
 * Get followers for a user
 */
async function getFollowers(req, res, userId, currentUser, limit, offset) {
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' })
  }

  let sql = `
    SELECT
      u.id,
      u.username,
      u.display_name,
      u.avatar_url,
      f.created_at as followed_at
  `

  // If logged in, check if current user follows each follower
  if (currentUser) {
    sql += `,
      (SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id) as is_following
    `
  }

  sql += `
    FROM follows f
    JOIN users u ON f.follower_id = u.id
    WHERE f.following_id = ?
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `

  const params = currentUser
    ? [currentUser.id, parseInt(userId), limit, offset]
    : [parseInt(userId), limit, offset]

  const followers = await query(sql, params)

  // Get total count
  const countResult = await queryOne(
    'SELECT COUNT(*) as total FROM follows WHERE following_id = ?',
    [parseInt(userId)]
  )

  return res.status(200).json({
    followers: followers.map(f => ({
      id: f.id,
      username: f.username,
      displayName: f.display_name,
      avatarUrl: f.avatar_url,
      followedAt: f.followed_at,
      isFollowing: !!f.is_following
    })),
    total: countResult.total,
    hasMore: offset + followers.length < countResult.total
  })
}

/**
 * Get users that a user follows
 */
async function getFollowing(req, res, userId, currentUser, limit, offset) {
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' })
  }

  let sql = `
    SELECT
      u.id,
      u.username,
      u.display_name,
      u.avatar_url,
      f.created_at as followed_at
  `

  // If logged in, check if current user follows each user
  if (currentUser) {
    sql += `,
      (SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id) as is_following
    `
  }

  sql += `
    FROM follows f
    JOIN users u ON f.following_id = u.id
    WHERE f.follower_id = ?
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `

  const params = currentUser
    ? [currentUser.id, parseInt(userId), limit, offset]
    : [parseInt(userId), limit, offset]

  const following = await query(sql, params)

  // Get total count
  const countResult = await queryOne(
    'SELECT COUNT(*) as total FROM follows WHERE follower_id = ?',
    [parseInt(userId)]
  )

  return res.status(200).json({
    following: following.map(f => ({
      id: f.id,
      username: f.username,
      displayName: f.display_name,
      avatarUrl: f.avatar_url,
      followedAt: f.followed_at,
      isFollowing: currentUser ? (currentUser.id === parseInt(userId) ? true : !!f.is_following) : false
    })),
    total: countResult.total,
    hasMore: offset + following.length < countResult.total
  })
}

/**
 * Get activity feed from followed users
 */
async function getActivityFeed(req, res, currentUser, limit, offset) {
  if (!currentUser) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  // Get recent contributions from users the current user follows
  const sql = `
    SELECT
      c.id,
      c.place_id,
      c.contribution_type,
      c.content,
      c.upvotes,
      c.downvotes,
      c.created_at,
      u.id as user_id,
      u.username,
      u.display_name,
      u.avatar_url
    FROM contributions c
    JOIN users u ON c.user_id = u.id
    WHERE c.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
    AND c.status IN ('approved', 'pending')
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `

  const activities = await query(sql, [currentUser.id, limit, offset])

  // Get total count
  const countResult = await queryOne(
    `SELECT COUNT(*) as total FROM contributions
     WHERE user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
     AND status IN ('approved', 'pending')`,
    [currentUser.id]
  )

  return res.status(200).json({
    activities: activities.map(a => ({
      id: a.id,
      type: 'contribution',
      placeId: a.place_id,
      contributionType: a.contribution_type,
      content: a.content,
      upvotes: a.upvotes,
      downvotes: a.downvotes,
      score: a.upvotes - a.downvotes,
      createdAt: a.created_at,
      user: {
        id: a.user_id,
        username: a.username,
        displayName: a.display_name,
        avatarUrl: a.avatar_url
      }
    })),
    total: countResult.total,
    hasMore: offset + activities.length < countResult.total
  })
}

/**
 * Discover users - "People Like You"
 * Finds users who have saved similar places
 */
async function discoverUsers(req, res, currentUser, limit) {
  if (!currentUser) {
    // For anonymous users, show active contributors
    const sql = `
      SELECT
        u.id,
        u.username,
        u.display_name,
        u.avatar_url,
        COUNT(c.id) as contribution_count
      FROM users u
      LEFT JOIN contributions c ON u.id = c.user_id AND c.status IN ('approved', 'pending')
      WHERE u.username IS NOT NULL
      GROUP BY u.id
      HAVING contribution_count > 0
      ORDER BY contribution_count DESC
      LIMIT ?
    `
    const users = await query(sql, [limit])

    return res.status(200).json({
      users: users.map(u => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        avatarUrl: u.avatar_url,
        contributionCount: u.contribution_count,
        isFollowing: false,
        matchReason: 'Active contributor'
      }))
    })
  }

  // For logged in users, find users with similar saved places
  const sql = `
    SELECT
      u.id,
      u.username,
      u.display_name,
      u.avatar_url,
      COUNT(DISTINCT sp2.place_id) as common_saves,
      (SELECT COUNT(*) FROM contributions WHERE user_id = u.id AND status IN ('approved', 'pending')) as contribution_count,
      (SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id) as is_following
    FROM users u
    JOIN saved_places sp2 ON u.id = sp2.user_id
    WHERE sp2.place_id IN (SELECT place_id FROM saved_places WHERE user_id = ?)
    AND u.id != ?
    AND u.username IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id)
    GROUP BY u.id
    ORDER BY common_saves DESC, contribution_count DESC
    LIMIT ?
  `

  const similarUsers = await query(sql, [currentUser.id, currentUser.id, currentUser.id, currentUser.id, limit])

  // If not enough similar users, fill with active contributors
  if (similarUsers.length < limit) {
    const excludeIds = [currentUser.id, ...similarUsers.map(u => u.id)]
    const fillSql = `
      SELECT
        u.id,
        u.username,
        u.display_name,
        u.avatar_url,
        0 as common_saves,
        COUNT(c.id) as contribution_count,
        (SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id) as is_following
      FROM users u
      LEFT JOIN contributions c ON u.id = c.user_id AND c.status IN ('approved', 'pending')
      WHERE u.id NOT IN (${excludeIds.map(() => '?').join(',')})
      AND u.username IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id)
      GROUP BY u.id
      HAVING contribution_count > 0
      ORDER BY contribution_count DESC
      LIMIT ?
    `
    const fillUsers = await query(fillSql, [currentUser.id, ...excludeIds, currentUser.id, limit - similarUsers.length])
    similarUsers.push(...fillUsers)
  }

  return res.status(200).json({
    users: similarUsers.map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      avatarUrl: u.avatar_url,
      commonSaves: u.common_saves,
      contributionCount: u.contribution_count,
      isFollowing: !!u.is_following,
      matchReason: u.common_saves > 0
        ? `${u.common_saves} places in common`
        : 'Active contributor'
    }))
  })
}

/**
 * Follow a user
 */
async function followUser(req, res, user) {
  const { userId } = req.body

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' })
  }

  const targetUserId = parseInt(userId)

  if (targetUserId === user.id) {
    return res.status(400).json({ error: 'Cannot follow yourself' })
  }

  // Check target user exists
  const targetUser = await queryOne('SELECT id, username FROM users WHERE id = ?', [targetUserId])
  if (!targetUser) {
    return res.status(404).json({ error: 'User not found' })
  }

  // Check if already following
  const existing = await queryOne(
    'SELECT id FROM follows WHERE follower_id = ? AND following_id = ?',
    [user.id, targetUserId]
  )

  if (existing) {
    return res.status(200).json({ success: true, message: 'Already following' })
  }

  // Create follow
  await insert(
    'INSERT INTO follows (follower_id, following_id) VALUES (?, ?)',
    [user.id, targetUserId]
  )

  // Get follower's username for notification
  const followerInfo = await queryOne('SELECT username, display_name FROM users WHERE id = ?', [user.id])
  const followerName = followerInfo?.display_name || followerInfo?.username || 'Someone'

  // Create notification for the followed user
  await createNotification({
    userId: targetUserId,
    actorId: user.id,
    type: 'follow',
    title: 'New follower',
    message: `${followerName} started following you`,
    data: { followerUsername: followerInfo?.username }
  })

  // Get updated follower count for target user
  const countResult = await queryOne(
    'SELECT COUNT(*) as count FROM follows WHERE following_id = ?',
    [targetUserId]
  )

  return res.status(200).json({
    success: true,
    followerCount: countResult.count
  })
}

/**
 * Unfollow a user
 */
async function unfollowUser(req, res, user) {
  const { userId } = req.body

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' })
  }

  const targetUserId = parseInt(userId)

  await update(
    'DELETE FROM follows WHERE follower_id = ? AND following_id = ?',
    [user.id, targetUserId]
  )

  // Get updated follower count for target user
  const countResult = await queryOne(
    'SELECT COUNT(*) as count FROM follows WHERE following_id = ?',
    [targetUserId]
  )

  return res.status(200).json({
    success: true,
    followerCount: countResult.count
  })
}

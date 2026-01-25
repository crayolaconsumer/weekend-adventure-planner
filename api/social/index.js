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
import { notifyNewFollower } from '../lib/pushNotifications.js'
import { hasBlockBetween } from './block.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { validateId, validatePagination } from '../lib/validation.js'

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
  const { action, userId, limit: queryLimit, offset: queryOffset } = req.query
  const currentUser = await getUserFromRequest(req)

  // Validate pagination
  const { limit, offset } = validatePagination(queryLimit, queryOffset, 50)

  switch (action) {
    case 'followers':
      return await getFollowers(req, res, userId, currentUser, limit, offset)
    case 'following':
      return await getFollowing(req, res, userId, currentUser, limit, offset)
    case 'feed':
      return await getActivityFeed(req, res, currentUser, limit, offset)
    case 'discover':
      return await discoverUsers(req, res, currentUser, limit)
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
    AND c.status = 'approved'
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `

  const activities = await query(sql, [currentUser.id, limit, offset])

  // Get total count
  const countResult = await queryOne(
    `SELECT COUNT(*) as total FROM contributions
     WHERE user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
     AND status = 'approved'`,
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
 * Filters out blocked users and respects privacy settings
 */
async function discoverUsers(req, res, currentUser, limit) {
  if (!currentUser) {
    // For anonymous users, show active contributors (public accounts only)
    const sql = `
      SELECT
        u.id,
        u.username,
        u.display_name,
        u.avatar_url,
        COUNT(c.id) as contribution_count
      FROM users u
      LEFT JOIN contributions c ON u.id = c.user_id AND c.status = 'approved'
      LEFT JOIN user_privacy_settings ups ON u.id = ups.user_id
      WHERE u.username IS NOT NULL
      AND (ups.is_private_account IS NULL OR ups.is_private_account = FALSE)
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
        isPrivate: false,
        matchReason: 'Active contributor'
      }))
    })
  }

  // For logged in users, find users with similar saved places
  // Exclude blocked users in both directions
  const sql = `
    SELECT
      u.id,
      u.username,
      u.display_name,
      u.avatar_url,
      COUNT(DISTINCT sp2.place_id) as common_saves,
      (SELECT COUNT(*) FROM contributions WHERE user_id = u.id AND status = 'approved') as contribution_count,
      (SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id) as is_following,
      COALESCE(ups.is_private_account, FALSE) as is_private
    FROM users u
    JOIN saved_places sp2 ON u.id = sp2.user_id
    LEFT JOIN user_privacy_settings ups ON u.id = ups.user_id
    WHERE sp2.place_id IN (SELECT place_id FROM saved_places WHERE user_id = ?)
    AND u.id != ?
    AND u.username IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = u.id) OR (blocker_id = u.id AND blocked_id = ?))
    GROUP BY u.id
    ORDER BY common_saves DESC, contribution_count DESC
    LIMIT ?
  `

  const similarUsers = await query(sql, [currentUser.id, currentUser.id, currentUser.id, currentUser.id, currentUser.id, currentUser.id, limit])

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
        (SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id) as is_following,
        COALESCE(ups.is_private_account, FALSE) as is_private
      FROM users u
      LEFT JOIN contributions c ON u.id = c.user_id AND c.status = 'approved'
      LEFT JOIN user_privacy_settings ups ON u.id = ups.user_id
      WHERE u.id NOT IN (${excludeIds.map(() => '?').join(',')})
      AND u.username IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = u.id) OR (blocker_id = u.id AND blocked_id = ?))
      GROUP BY u.id
      HAVING contribution_count > 0
      ORDER BY contribution_count DESC
      LIMIT ?
    `
    const fillUsers = await query(fillSql, [currentUser.id, ...excludeIds, currentUser.id, currentUser.id, currentUser.id, limit - similarUsers.length])
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
      isPrivate: !!u.is_private,
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
  // Rate limit follow requests to prevent spam
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.FOLLOW, 'social:follow')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const { userId } = req.body

  // Validate userId
  const idValidation = validateId(userId)
  if (!idValidation.valid) {
    return res.status(400).json({ error: 'Invalid userId' })
  }

  const targetUserId = idValidation.id

  if (targetUserId === user.id) {
    return res.status(400).json({ error: 'Cannot follow yourself' })
  }

  // Check target user exists
  const targetUser = await queryOne('SELECT id, username FROM users WHERE id = ?', [targetUserId])
  if (!targetUser) {
    return res.status(404).json({ error: 'User not found' })
  }

  // Check if blocked
  const blocked = await hasBlockBetween(user.id, targetUserId)
  if (blocked) {
    return res.status(403).json({ error: 'Unable to follow this user' })
  }

  // Check if already following
  const existing = await queryOne(
    'SELECT id FROM follows WHERE follower_id = ? AND following_id = ?',
    [user.id, targetUserId]
  )

  if (existing) {
    return res.status(200).json({ success: true, message: 'Already following', status: 'following' })
  }

  // Check if target user has private account
  const privacySettings = await queryOne(
    'SELECT is_private_account FROM user_privacy_settings WHERE user_id = ?',
    [targetUserId]
  )

  if (privacySettings?.is_private_account) {
    // Check if there's already a pending request
    const existingRequest = await queryOne(
      'SELECT id, status FROM follow_requests WHERE requester_id = ? AND target_id = ?',
      [user.id, targetUserId]
    )

    if (existingRequest) {
      if (existingRequest.status === 'pending') {
        return res.status(200).json({ success: true, message: 'Request already pending', status: 'requested' })
      }
      // If previously rejected, allow new request
      if (existingRequest.status === 'rejected') {
        await update(
          'UPDATE follow_requests SET status = ?, created_at = NOW() WHERE id = ?',
          ['pending', existingRequest.id]
        )
      }
    } else {
      // Create follow request
      await insert(
        'INSERT INTO follow_requests (requester_id, target_id, status) VALUES (?, ?, ?)',
        [user.id, targetUserId, 'pending']
      )
    }

    // Get follower's username for notification
    const followerInfo = await queryOne('SELECT username, display_name FROM users WHERE id = ?', [user.id])
    const followerName = followerInfo?.display_name || followerInfo?.username || 'Someone'

    // Create notification for the target user
    await createNotification({
      userId: targetUserId,
      actorId: user.id,
      type: 'follow_request',
      title: 'Follow request',
      message: `${followerName} wants to follow you`,
      data: { requesterUsername: followerInfo?.username }
    })

    return res.status(200).json({
      success: true,
      message: 'Follow request sent',
      status: 'requested'
    })
  }

  // Public account - create follow directly
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

  // Send push notification (non-blocking)
  notifyNewFollower(user.id, targetUserId, followerInfo?.username).catch(() => {})

  // Get updated follower count for target user
  const countResult = await queryOne(
    'SELECT COUNT(*) as count FROM follows WHERE following_id = ?',
    [targetUserId]
  )

  return res.status(200).json({
    success: true,
    followerCount: countResult.count,
    status: 'following'
  })
}

/**
 * Unfollow a user (also cancels pending follow requests)
 */
async function unfollowUser(req, res, user) {
  const { userId } = req.body

  // Validate userId
  const idValidation = validateId(userId)
  if (!idValidation.valid) {
    return res.status(400).json({ error: 'Invalid userId' })
  }

  const targetUserId = idValidation.id

  // Delete follow relationship if exists
  await update(
    'DELETE FROM follows WHERE follower_id = ? AND following_id = ?',
    [user.id, targetUserId]
  )

  // Also cancel any pending follow request
  await update(
    'DELETE FROM follow_requests WHERE requester_id = ? AND target_id = ? AND status = ?',
    [user.id, targetUserId, 'pending']
  )

  // Get updated follower count for target user
  const countResult = await queryOne(
    'SELECT COUNT(*) as count FROM follows WHERE following_id = ?',
    [targetUserId]
  )

  return res.status(200).json({
    success: true,
    followerCount: countResult.count,
    status: 'not_following'
  })
}

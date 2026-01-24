/**
 * GET/POST /api/social/block
 *
 * Manage blocked users
 *
 * GET: List blocked users
 * POST: Block or unblock a user
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, insert, update } from '../lib/db.js'

export default async function handler(req, res) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    switch (req.method) {
      case 'GET':
        return await getBlockedUsers(req, res, user)
      case 'POST':
        return await handleBlockAction(req, res, user)
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('Block API error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * Get list of users blocked by the current user
 */
async function getBlockedUsers(req, res, user) {
  const { limit = 50, offset = 0 } = req.query

  const blockedUsers = await query(
    `SELECT
      bu.id as block_id,
      bu.created_at as blocked_at,
      u.id,
      u.username,
      u.display_name,
      u.avatar_url
    FROM blocked_users bu
    JOIN users u ON bu.blocked_id = u.id
    WHERE bu.blocker_id = ?
    ORDER BY bu.created_at DESC
    LIMIT ? OFFSET ?`,
    [user.id, parseInt(limit), parseInt(offset)]
  )

  const countResult = await queryOne(
    'SELECT COUNT(*) as total FROM blocked_users WHERE blocker_id = ?',
    [user.id]
  )

  return res.status(200).json({
    blockedUsers: blockedUsers.map(u => ({
      blockId: u.block_id,
      blockedAt: u.blocked_at,
      user: {
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        avatarUrl: u.avatar_url
      }
    })),
    total: countResult?.total || 0,
    hasMore: parseInt(offset) + blockedUsers.length < (countResult?.total || 0)
  })
}

/**
 * Block or unblock a user
 */
async function handleBlockAction(req, res, user) {
  const { action, userId } = req.body

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' })
  }

  if (!action || !['block', 'unblock'].includes(action)) {
    return res.status(400).json({ error: 'action must be "block" or "unblock"' })
  }

  const targetUserId = parseInt(userId)

  if (targetUserId === user.id) {
    return res.status(400).json({ error: 'Cannot block yourself' })
  }

  // Check target user exists
  const targetUser = await queryOne('SELECT id FROM users WHERE id = ?', [targetUserId])
  if (!targetUser) {
    return res.status(404).json({ error: 'User not found' })
  }

  if (action === 'block') {
    // Check if already blocked
    const existingBlock = await queryOne(
      'SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?',
      [user.id, targetUserId]
    )

    if (existingBlock) {
      return res.status(200).json({ success: true, message: 'User already blocked' })
    }

    // Create block
    await insert(
      'INSERT INTO blocked_users (blocker_id, blocked_id) VALUES (?, ?)',
      [user.id, targetUserId]
    )

    // Remove any follow relationships in both directions
    await update(
      'DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)',
      [user.id, targetUserId, targetUserId, user.id]
    )

    // Remove any pending follow requests in both directions
    await update(
      'DELETE FROM follow_requests WHERE (requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?)',
      [user.id, targetUserId, targetUserId, user.id]
    )

    return res.status(200).json({
      success: true,
      action: 'blocked',
      message: 'User has been blocked'
    })
  } else {
    // Unblock
    const deleted = await update(
      'DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?',
      [user.id, targetUserId]
    )

    return res.status(200).json({
      success: true,
      action: 'unblocked',
      message: deleted > 0 ? 'User has been unblocked' : 'User was not blocked'
    })
  }
}

/**
 * Check if user A is blocked by user B (helper for other APIs)
 */
export async function isBlocked(blockerId, blockedId) {
  const result = await queryOne(
    'SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?',
    [blockerId, blockedId]
  )
  return !!result
}

/**
 * Check if there's any block between two users (helper for other APIs)
 */
export async function hasBlockBetween(userId1, userId2) {
  const result = await queryOne(
    'SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
    [userId1, userId2, userId2, userId1]
  )
  return !!result
}

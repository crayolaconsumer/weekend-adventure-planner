/**
 * GET /api/users/[username]
 *
 * Get public user profile by username
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne } from '../lib/db.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { username } = req.query
    const currentUser = await getUserFromRequest(req)

    if (!username) {
      return res.status(400).json({ error: 'Username is required' })
    }

    // Get user profile
    const user = await queryOne(
      `SELECT
        id,
        username,
        display_name,
        avatar_url,
        created_at
      FROM users
      WHERE username = ?`,
      [username]
    )

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Get stats
    const [followerCount, followingCount, contributionCount, savedPlacesCount] = await Promise.all([
      queryOne('SELECT COUNT(*) as count FROM follows WHERE following_id = ?', [user.id]),
      queryOne('SELECT COUNT(*) as count FROM follows WHERE follower_id = ?', [user.id]),
      queryOne('SELECT COUNT(*) as count FROM contributions WHERE user_id = ? AND status IN ("approved", "pending")', [user.id]),
      queryOne('SELECT COUNT(*) as count FROM saved_places WHERE user_id = ?', [user.id])
    ])

    // Check if current user follows this user
    let isFollowing = false
    let isOwnProfile = false

    if (currentUser) {
      isOwnProfile = currentUser.id === user.id
      if (!isOwnProfile) {
        const followCheck = await queryOne(
          'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?',
          [currentUser.id, user.id]
        )
        isFollowing = !!followCheck
      }
    }

    // Get recent contributions
    const contributions = await query(
      `SELECT
        c.id,
        c.place_id,
        c.contribution_type,
        c.content,
        c.upvotes,
        c.downvotes,
        c.created_at
      FROM contributions c
      WHERE c.user_id = ? AND c.status IN ('approved', 'pending')
      ORDER BY c.created_at DESC
      LIMIT 10`,
      [user.id]
    )

    // Get helpful votes received (sum of upvotes on their contributions)
    const helpfulVotes = await queryOne(
      'SELECT COALESCE(SUM(upvotes), 0) as total FROM contributions WHERE user_id = ? AND status IN ("approved", "pending")',
      [user.id]
    )

    return res.status(200).json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        joinedAt: user.created_at
      },
      stats: {
        followers: followerCount.count,
        following: followingCount.count,
        contributions: contributionCount.count,
        savedPlaces: savedPlacesCount.count,
        helpfulVotes: helpfulVotes.total
      },
      contributions: contributions.map(c => ({
        id: c.id,
        placeId: c.place_id,
        type: c.contribution_type,
        content: c.content,
        upvotes: c.upvotes,
        downvotes: c.downvotes,
        score: c.upvotes - c.downvotes,
        createdAt: c.created_at
      })),
      isFollowing,
      isOwnProfile
    })
  } catch (error) {
    console.error('User profile error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

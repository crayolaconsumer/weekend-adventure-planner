/**
 * GET /api/users/[username]
 *
 * Get public user profile by username
 * Respects privacy settings and block status
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne } from '../lib/db.js'
import { hasBlockBetween } from '../social/block.js'

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

    // Check if blocked
    if (currentUser && currentUser.id !== user.id) {
      const blocked = await hasBlockBetween(currentUser.id, user.id)
      if (blocked) {
        return res.status(404).json({ error: 'User not found' })
      }
    }

    // Check if current user follows this user and check for pending request
    let isFollowing = false
    let isOwnProfile = false
    let followStatus = 'not_following' // 'not_following', 'following', 'requested'

    if (currentUser) {
      isOwnProfile = currentUser.id === user.id
      if (!isOwnProfile) {
        const followCheck = await queryOne(
          'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?',
          [currentUser.id, user.id]
        )
        isFollowing = !!followCheck
        followStatus = isFollowing ? 'following' : 'not_following'

        if (!isFollowing) {
          // Check for pending request
          const pendingRequest = await queryOne(
            'SELECT 1 FROM follow_requests WHERE requester_id = ? AND target_id = ? AND status = ?',
            [currentUser.id, user.id, 'pending']
          )
          if (pendingRequest) {
            followStatus = 'requested'
          }
        }
      }
    }

    // Get privacy settings
    const privacySettings = await queryOne(
      'SELECT * FROM user_privacy_settings WHERE user_id = ?',
      [user.id]
    )

    const isPrivateAccount = !!privacySettings?.is_private_account
    const hideFollowersList = !!privacySettings?.hide_followers_list
    const hideFollowingList = !!privacySettings?.hide_following_list

    // Determine if current user can see full profile
    const canSeeFullProfile = isOwnProfile || !isPrivateAccount || isFollowing

    // Get stats
    const [followerCount, followingCount, contributionCount, savedPlacesCount] = await Promise.all([
      queryOne('SELECT COUNT(*) as count FROM follows WHERE following_id = ?', [user.id]),
      queryOne('SELECT COUNT(*) as count FROM follows WHERE follower_id = ?', [user.id]),
      queryOne('SELECT COUNT(*) as count FROM contributions WHERE user_id = ? AND status IN ("approved", "pending")', [user.id]),
      queryOne('SELECT COUNT(*) as count FROM saved_places WHERE user_id = ?', [user.id])
    ])

    // For private profiles that user can't see, return limited data
    if (!canSeeFullProfile) {
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
          contributions: 0,
          savedPlaces: 0,
          helpfulVotes: 0
        },
        contributions: [],
        isFollowing,
        followStatus,
        isOwnProfile,
        isPrivateAccount: true,
        canSeeFullProfile: false,
        hideFollowersList,
        hideFollowingList
      })
    }

    // Get recent contributions (respecting visibility settings)
    let contributionSql = `
      SELECT
        c.id,
        c.place_id,
        c.contribution_type,
        c.content,
        c.upvotes,
        c.downvotes,
        c.created_at,
        c.visibility
      FROM contributions c
      WHERE c.user_id = ? AND c.status IN ('approved', 'pending')
    `

    // Filter by visibility unless viewing own profile
    if (!isOwnProfile) {
      if (isFollowing) {
        // Can see public and followers_only
        contributionSql += ` AND c.visibility IN ('public', 'followers_only')`
      } else {
        // Can only see public
        contributionSql += ` AND c.visibility = 'public'`
      }
    }

    contributionSql += ` ORDER BY c.created_at DESC LIMIT 10`

    const contributions = await query(contributionSql, [user.id])

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
        createdAt: c.created_at,
        visibility: c.visibility || 'public'
      })),
      isFollowing,
      followStatus,
      isOwnProfile,
      isPrivateAccount,
      canSeeFullProfile: true,
      hideFollowersList: isOwnProfile ? false : hideFollowersList,
      hideFollowingList: isOwnProfile ? false : hideFollowingList
    })
  } catch (error) {
    console.error('User profile error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

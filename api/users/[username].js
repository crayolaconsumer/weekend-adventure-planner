/**
 * GET /api/users/[username]
 *
 * Get public user profile by username
 * Respects privacy settings and block status
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne } from '../lib/db.js'
import { hasBlockBetween } from '../social/block.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

export default async function handler(req, res) {
  // Rate limit profile lookups to prevent enumeration
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'users:profile')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

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
    // SECURITY: Default to private if no settings exist (opt-in to public)
    const privacySettings = await queryOne(
      'SELECT * FROM user_privacy_settings WHERE user_id = ?',
      [user.id]
    )

    // Default to private account if no privacy settings row exists
    // This ensures new users are private by default until they explicitly choose public
    const isPrivateAccount = privacySettings === null ? true : !!privacySettings.is_private_account
    const hideFollowersList = privacySettings === null ? true : !!privacySettings.hide_followers_list
    const hideFollowingList = privacySettings === null ? true : !!privacySettings.hide_following_list

    // Determine if current user can see full profile
    const canSeeFullProfile = isOwnProfile || !isPrivateAccount || isFollowing

    // Get stats (including places visited and pending contributions for own profile)
    const contributionStatusFilter = isOwnProfile ? 'IN ("approved", "pending")' : '= "approved"'
    const [followerCount, followingCount, contributionCount, savedPlacesCount, placesVisitedCount, placesRatedCount, userStats] = await Promise.all([
      queryOne('SELECT COUNT(*) as count FROM follows WHERE following_id = ?', [user.id]),
      queryOne('SELECT COUNT(*) as count FROM follows WHERE follower_id = ?', [user.id]),
      queryOne(`SELECT COUNT(*) as count FROM contributions WHERE user_id = ? AND status ${contributionStatusFilter}`, [user.id]),
      queryOne('SELECT COUNT(*) as count FROM saved_places WHERE user_id = ?', [user.id]),
      queryOne('SELECT COUNT(*) as count FROM visited_places WHERE user_id = ?', [user.id]),
      queryOne('SELECT COUNT(*) as count FROM place_ratings WHERE user_id = ?', [user.id]),
      queryOne('SELECT places_visited, places_rated FROM user_stats WHERE user_id = ?', [user.id])
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
          helpfulVotes: 0,
          placesVisited: 0,
          placesRated: 0
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

    // Get unified activity: contributions + visits
    // Build UNION query for unified activity feed
    let activityParts = []
    const activityParams = []

    // Contributions query
    let contributionVisibility = ''
    if (isOwnProfile) {
      contributionVisibility = `AND c.status IN ('approved', 'pending')`
    } else {
      contributionVisibility = `AND c.status = 'approved'`
      if (isFollowing) {
        contributionVisibility += ` AND c.visibility IN ('public', 'followers_only')`
      } else {
        contributionVisibility += ` AND c.visibility = 'public'`
      }
    }

    activityParts.push(`
      SELECT
        CONCAT('contrib_', c.id) as id,
        CASE c.contribution_type
          WHEN 'photo' THEN 'photo'
          ELSE 'tip'
        END as activity_type,
        c.place_id,
        c.contribution_type,
        c.content,
        c.upvotes,
        c.downvotes,
        c.created_at,
        c.visibility,
        c.status,
        c.place_name,
        c.place_category,
        c.place_image_url,
        NULL as rating,
        NULL as place_data
      FROM contributions c
      WHERE c.user_id = ? ${contributionVisibility}
    `)
    activityParams.push(user.id)

    // Visits query (only show if can see full profile)
    activityParts.push(`
      SELECT
        CONCAT('visit_', vp.id) as id,
        'visit' as activity_type,
        vp.place_id,
        NULL as contribution_type,
        vp.notes as content,
        0 as upvotes,
        0 as downvotes,
        vp.visited_at as created_at,
        'public' as visibility,
        'approved' as status,
        NULL as place_name,
        NULL as place_category,
        NULL as place_image_url,
        vp.rating,
        vp.place_data
      FROM visited_places vp
      WHERE vp.user_id = ?
    `)
    activityParams.push(user.id)

    const activitySql = `
      SELECT * FROM (
        ${activityParts.join(' UNION ALL ')}
      ) AS combined
      ORDER BY created_at DESC
      LIMIT 15
    `

    const activities = await query(activitySql, activityParams)

    // Get helpful votes received (sum of upvotes on approved contributions only)
    const helpfulVotes = await queryOne(
      'SELECT COALESCE(SUM(upvotes), 0) as total FROM contributions WHERE user_id = ? AND status = "approved"',
      [user.id]
    )

    // Safe JSON parse helper
    const safeJsonParse = (data, defaultValue = null) => {
      if (!data) return defaultValue
      if (typeof data === 'object') return data
      try {
        return JSON.parse(data)
      } catch {
        return defaultValue
      }
    }

    // Format activities for response
    const formattedActivities = activities.map(a => {
      const placeData = safeJsonParse(a.place_data)

      return {
        id: a.id,
        activityType: a.activity_type,
        placeId: a.place_id,
        type: a.contribution_type,
        content: a.content,
        upvotes: a.upvotes || 0,
        downvotes: a.downvotes || 0,
        score: (a.upvotes || 0) - (a.downvotes || 0),
        rating: a.rating,
        createdAt: a.created_at,
        visibility: a.visibility || 'public',
        status: isOwnProfile ? a.status : 'approved',
        place: {
          id: a.place_id,
          name: a.place_name || placeData?.name || null,
          category: a.place_category || placeData?.category?.key || null,
          imageUrl: a.place_image_url || placeData?.image || null
        }
      }
    })

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
        helpfulVotes: helpfulVotes.total,
        placesVisited: placesVisitedCount?.count || userStats?.places_visited || 0,
        placesRated: placesRatedCount?.count || userStats?.places_rated || 0
      },
      // Keep contributions for backwards compatibility
      contributions: formattedActivities.filter(a => a.activityType !== 'visit').map(c => ({
        id: c.id,
        placeId: c.placeId,
        type: c.type,
        content: c.content,
        upvotes: c.upvotes,
        downvotes: c.downvotes,
        score: c.score,
        createdAt: c.createdAt,
        visibility: c.visibility,
        status: c.status
      })),
      // New unified activity feed
      activities: formattedActivities,
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

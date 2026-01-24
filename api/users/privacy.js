/**
 * GET/POST /api/users/privacy
 *
 * Manage user privacy settings
 *
 * GET: Retrieve current privacy settings
 * POST: Update privacy settings
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
        return await getPrivacySettings(req, res, user)
      case 'POST':
        return await updatePrivacySettings(req, res, user)
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('Privacy API error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * Get privacy settings for the current user
 * Creates default settings if they don't exist
 */
async function getPrivacySettings(req, res, user) {
  // Get or create privacy settings
  let settings = await queryOne(
    'SELECT * FROM user_privacy_settings WHERE user_id = ?',
    [user.id]
  )

  if (!settings) {
    // Create default settings
    await insert(
      'INSERT INTO user_privacy_settings (user_id) VALUES (?)',
      [user.id]
    )
    settings = await queryOne(
      'SELECT * FROM user_privacy_settings WHERE user_id = ?',
      [user.id]
    )
  }

  // Get pending follow request count
  const pendingCount = await queryOne(
    'SELECT COUNT(*) as count FROM follow_requests WHERE target_id = ? AND status = ?',
    [user.id, 'pending']
  )

  return res.status(200).json({
    settings: {
      isPrivateAccount: !!settings.is_private_account,
      showInSearch: !!settings.show_in_search,
      hideFollowersList: !!settings.hide_followers_list,
      hideFollowingList: !!settings.hide_following_list
    },
    pendingRequestCount: pendingCount?.count || 0
  })
}

/**
 * Update privacy settings for the current user
 */
async function updatePrivacySettings(req, res, user) {
  const {
    isPrivateAccount,
    showInSearch,
    hideFollowersList,
    hideFollowingList
  } = req.body

  // Ensure settings row exists
  const existing = await queryOne(
    'SELECT id, is_private_account FROM user_privacy_settings WHERE user_id = ?',
    [user.id]
  )

  if (!existing) {
    await insert(
      'INSERT INTO user_privacy_settings (user_id) VALUES (?)',
      [user.id]
    )
  }

  // Track if going from private to public
  const wasPrivate = existing?.is_private_account
  const goingPublic = wasPrivate && isPrivateAccount === false

  // Build update query dynamically based on provided fields
  const updates = []
  const params = []

  if (isPrivateAccount !== undefined) {
    updates.push('is_private_account = ?')
    params.push(isPrivateAccount)
  }
  if (showInSearch !== undefined) {
    updates.push('show_in_search = ?')
    params.push(showInSearch)
  }
  if (hideFollowersList !== undefined) {
    updates.push('hide_followers_list = ?')
    params.push(hideFollowersList)
  }
  if (hideFollowingList !== undefined) {
    updates.push('hide_following_list = ?')
    params.push(hideFollowingList)
  }

  if (updates.length > 0) {
    params.push(user.id)
    await update(
      `UPDATE user_privacy_settings SET ${updates.join(', ')} WHERE user_id = ?`,
      params
    )
  }

  // If going from private to public, auto-approve all pending requests
  if (goingPublic) {
    const pendingRequests = await query(
      'SELECT requester_id FROM follow_requests WHERE target_id = ? AND status = ?',
      [user.id, 'pending']
    )

    // Convert pending requests to actual follows
    for (const request of pendingRequests) {
      // Check if already following (shouldn't happen but safety check)
      const existingFollow = await queryOne(
        'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?',
        [request.requester_id, user.id]
      )

      if (!existingFollow) {
        await insert(
          'INSERT INTO follows (follower_id, following_id) VALUES (?, ?)',
          [request.requester_id, user.id]
        )
      }
    }

    // Delete all pending requests
    await update(
      'DELETE FROM follow_requests WHERE target_id = ? AND status = ?',
      [user.id, 'pending']
    )
  }

  // Return updated settings
  const settings = await queryOne(
    'SELECT * FROM user_privacy_settings WHERE user_id = ?',
    [user.id]
  )

  return res.status(200).json({
    success: true,
    settings: {
      isPrivateAccount: !!settings.is_private_account,
      showInSearch: !!settings.show_in_search,
      hideFollowersList: !!settings.hide_followers_list,
      hideFollowingList: !!settings.hide_following_list
    },
    autoApprovedRequests: goingPublic ? pendingRequests?.length || 0 : 0
  })
}

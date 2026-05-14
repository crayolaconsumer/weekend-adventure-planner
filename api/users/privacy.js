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
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'
import { resolvePrivacy, NEW_ROW_DEFAULTS } from '../lib/privacy.js'

async function handler(req, res) {
  // Apply rate limiting
  const rateLimit = req.method === 'GET' ? RATE_LIMITS.API_GENERAL : RATE_LIMITS.API_WRITE
  const rateLimitError = applyRateLimit(req, res, rateLimit, 'users:privacy')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

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
 *
 * Previously this endpoint INSERTed a default row when none existed —
 * but the schema defaults (is_private_account=0, etc) flip the user
 * silently from default-private (no row → private per resolvePrivacy())
 * to default-public the moment they open the settings page. Now we
 * compute defaults in JS instead; the row is only created on the user's
 * first explicit save.
 */
async function getPrivacySettings(req, res, user) {
  const settings = await queryOne(
    'SELECT * FROM user_privacy_settings WHERE user_id = ?',
    [user.id]
  )

  const pendingCount = await queryOne(
    'SELECT COUNT(*) as count FROM follow_requests WHERE target_id = ? AND status = ?',
    [user.id, 'pending']
  )

  return res.status(200).json({
    settings: resolvePrivacy(settings),
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
    hideFollowingList,
    isMapPublic
  } = req.body

  // Ensure settings row exists
  const existing = await queryOne(
    'SELECT id, is_private_account FROM user_privacy_settings WHERE user_id = ?',
    [user.id]
  )

  if (!existing) {
    // Create the row with the same defaults resolvePrivacy() returns
    // for a missing row, so toggling a single unrelated field (e.g.
    // isMapPublic) doesn't silently flip the user from default-private
    // to default-public. NEW_ROW_DEFAULTS keeps this in lockstep with
    // PRIVACY_DEFAULTS in api/lib/privacy.js.
    await insert(
      `INSERT INTO user_privacy_settings
         (user_id, is_private_account, show_in_search, hide_followers_list, hide_following_list, is_map_public)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        NEW_ROW_DEFAULTS.is_private_account,
        NEW_ROW_DEFAULTS.show_in_search,
        NEW_ROW_DEFAULTS.hide_followers_list,
        NEW_ROW_DEFAULTS.hide_following_list,
        NEW_ROW_DEFAULTS.is_map_public,
      ]
    )
  }

  // Track if going from private to public. NULL row also counts as
  // private (matches resolvePrivacy()), so a user with no prior row
  // who toggles is_private off triggers the auto-approve flow correctly.
  const wasPrivate = existing ? !!existing.is_private_account : true
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
  if (isMapPublic !== undefined) {
    updates.push('is_map_public = ?')
    params.push(isMapPublic)
  }

  if (updates.length > 0) {
    params.push(user.id)
    await update(
      `UPDATE user_privacy_settings SET ${updates.join(', ')} WHERE user_id = ?`,
      params
    )
  }

  // Track auto-approved count for response
  let autoApprovedCount = 0

  // If going from private to public, auto-approve all pending requests
  if (goingPublic) {
    const pendingRequests = await query(
      'SELECT requester_id FROM follow_requests WHERE target_id = ? AND status = ?',
      [user.id, 'pending']
    )
    autoApprovedCount = pendingRequests.length

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
    settings: resolvePrivacy(settings),
    autoApprovedRequests: autoApprovedCount
  })
}

export default withCors(handler)

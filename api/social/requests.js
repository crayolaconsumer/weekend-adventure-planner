/**
 * GET/POST /api/social/requests
 *
 * Manage follow requests for private accounts
 *
 * GET: List pending/all follow requests
 * POST: Approve or reject a follow request
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, insert, update } from '../lib/db.js'
import { createNotification } from '../notifications/index.js'

export default async function handler(req, res) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    switch (req.method) {
      case 'GET':
        return await getFollowRequests(req, res, user)
      case 'POST':
        return await handleFollowRequest(req, res, user)
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('Follow requests API error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * Get pending follow requests for the current user
 */
async function getFollowRequests(req, res, user) {
  const { status = 'pending', limit = 50, offset = 0 } = req.query

  // Validate status
  const validStatuses = ['pending', 'approved', 'rejected', 'all']
  const filterStatus = validStatuses.includes(status) ? status : 'pending'

  let sql = `
    SELECT
      fr.id,
      fr.requester_id,
      fr.status,
      fr.created_at,
      u.username,
      u.display_name,
      u.avatar_url
    FROM follow_requests fr
    JOIN users u ON fr.requester_id = u.id
    WHERE fr.target_id = ?
  `

  const params = [user.id]

  if (filterStatus !== 'all') {
    sql += ' AND fr.status = ?'
    params.push(filterStatus)
  }

  sql += ' ORDER BY fr.created_at DESC LIMIT ? OFFSET ?'
  params.push(parseInt(limit), parseInt(offset))

  const requests = await query(sql, params)

  // Get total count for pagination
  let countSql = 'SELECT COUNT(*) as total FROM follow_requests WHERE target_id = ?'
  const countParams = [user.id]

  if (filterStatus !== 'all') {
    countSql += ' AND status = ?'
    countParams.push(filterStatus)
  }

  const countResult = await queryOne(countSql, countParams)

  return res.status(200).json({
    requests: requests.map(r => ({
      id: r.id,
      requesterId: r.requester_id,
      status: r.status,
      createdAt: r.created_at,
      user: {
        username: r.username,
        displayName: r.display_name,
        avatarUrl: r.avatar_url
      }
    })),
    total: countResult?.total || 0,
    hasMore: parseInt(offset) + requests.length < (countResult?.total || 0)
  })
}

/**
 * Approve or reject a follow request
 */
async function handleFollowRequest(req, res, user) {
  const { requestId, action } = req.body

  if (!requestId) {
    return res.status(400).json({ error: 'requestId is required' })
  }

  if (!action || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action must be "approve" or "reject"' })
  }

  // Get the request
  const request = await queryOne(
    'SELECT * FROM follow_requests WHERE id = ? AND target_id = ?',
    [requestId, user.id]
  )

  if (!request) {
    return res.status(404).json({ error: 'Follow request not found' })
  }

  if (request.status !== 'pending') {
    return res.status(400).json({ error: 'Request has already been processed' })
  }

  if (action === 'approve') {
    // Check if already following (shouldn't happen but safety check)
    const existingFollow = await queryOne(
      'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?',
      [request.requester_id, user.id]
    )

    if (!existingFollow) {
      // Create the follow relationship
      await insert(
        'INSERT INTO follows (follower_id, following_id) VALUES (?, ?)',
        [request.requester_id, user.id]
      )
    }

    // Update request status
    await update(
      'UPDATE follow_requests SET status = ? WHERE id = ?',
      ['approved', requestId]
    )

    // Get target user info for notification
    const targetUserInfo = await queryOne(
      'SELECT username, display_name FROM users WHERE id = ?',
      [user.id]
    )
    const targetName = targetUserInfo?.display_name || targetUserInfo?.username || 'Someone'

    // Notify the requester that their request was approved
    await createNotification({
      userId: request.requester_id,
      actorId: user.id,
      type: 'follow_request_approved',
      title: 'Follow request approved',
      message: `${targetName} accepted your follow request`,
      data: { targetUsername: targetUserInfo?.username }
    })

    return res.status(200).json({
      success: true,
      action: 'approved',
      message: 'Follow request approved'
    })
  } else {
    // Reject: just update the status
    await update(
      'UPDATE follow_requests SET status = ? WHERE id = ?',
      ['rejected', requestId]
    )

    return res.status(200).json({
      success: true,
      action: 'rejected',
      message: 'Follow request rejected'
    })
  }
}

/**
 * Cancel a sent follow request (called by requester)
 * POST body: { action: 'cancel', targetUserId: number }
 */
export async function cancelFollowRequest(user, targetUserId) {
  const result = await update(
    'DELETE FROM follow_requests WHERE requester_id = ? AND target_id = ? AND status = ?',
    [user.id, targetUserId, 'pending']
  )

  return result > 0
}

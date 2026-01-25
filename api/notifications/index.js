/**
 * GET/POST /api/notifications
 *
 * In-app notification system
 *
 * GET: Fetch user's notifications
 * POST actions:
 *   - mark_read: Mark notification(s) as read
 *   - mark_all_read: Mark all notifications as read
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, update } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

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

export default async function handler(req, res) {
  // Apply rate limiting
  const rateLimit = req.method === 'GET' ? RATE_LIMITS.API_GENERAL : RATE_LIMITS.API_WRITE
  const rateLimitError = applyRateLimit(req, res, rateLimit, 'notifications')
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
        return await getNotifications(req, res, user)
      case 'POST':
        return await handleAction(req, res, user)
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('Notifications API error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * Get user's notifications
 */
async function getNotifications(req, res, user) {
  const { limit = 20, offset = 0, unread_only = 'false' } = req.query
  const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 20), 50)
  const offsetNum = Math.max(0, parseInt(offset, 10) || 0)
  const unreadOnly = unread_only === 'true'

  let sql = `
    SELECT
      n.id,
      n.type,
      n.title,
      n.message,
      n.data,
      n.is_read,
      n.created_at,
      u.id as actor_id,
      u.username as actor_username,
      u.display_name as actor_display_name,
      u.avatar_url as actor_avatar_url
    FROM notifications n
    LEFT JOIN users u ON n.actor_id = u.id
    WHERE n.user_id = ?
  `

  const params = [user.id]

  if (unreadOnly) {
    sql += ` AND n.is_read = 0`
  }

  sql += ` ORDER BY n.created_at DESC LIMIT ? OFFSET ?`
  params.push(limitNum, offsetNum)

  const notifications = await query(sql, params)

  // Get unread count
  const unreadResult = await queryOne(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
    [user.id]
  )

  // Get total count
  let countSql = 'SELECT COUNT(*) as total FROM notifications WHERE user_id = ?'
  const countParams = [user.id]
  if (unreadOnly) {
    countSql += ' AND is_read = 0'
  }
  const countResult = await queryOne(countSql, countParams)

  return res.status(200).json({
    notifications: notifications.map(n => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      data: safeJsonParse(n.data),
      isRead: !!n.is_read,
      createdAt: n.created_at,
      actor: n.actor_id ? {
        id: n.actor_id,
        username: n.actor_username,
        displayName: n.actor_display_name,
        avatarUrl: n.actor_avatar_url
      } : null
    })),
    unreadCount: unreadResult.count,
    total: countResult.total,
    hasMore: offsetNum + notifications.length < countResult.total
  })
}

/**
 * Handle notification actions
 */
async function handleAction(req, res, user) {
  const { action, notificationIds } = req.body

  switch (action) {
    case 'mark_read':
      if (!notificationIds || !Array.isArray(notificationIds) || notificationIds.length === 0) {
        return res.status(400).json({ error: 'notificationIds array required' })
      }

      // M11: Validate each ID is a valid integer
      const validatedIds = []
      for (const id of notificationIds) {
        const parsed = parseInt(id, 10)
        if (isNaN(parsed) || parsed < 1 || parsed > Number.MAX_SAFE_INTEGER) {
          return res.status(400).json({ error: 'Invalid notification ID in array' })
        }
        validatedIds.push(parsed)
      }

      // Limit batch size to prevent abuse
      if (validatedIds.length > 100) {
        return res.status(400).json({ error: 'Maximum 100 notification IDs per request' })
      }

      // Only mark notifications belonging to this user
      const placeholders = validatedIds.map(() => '?').join(',')
      await update(
        `UPDATE notifications SET is_read = 1 WHERE id IN (${placeholders}) AND user_id = ?`,
        [...validatedIds, user.id]
      )

      return res.status(200).json({ success: true })

    case 'mark_all_read':
      await update(
        'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
        [user.id]
      )

      return res.status(200).json({ success: true })

    default:
      return res.status(400).json({ error: 'Invalid action. Use: mark_read or mark_all_read' })
  }
}

/**
 * Helper: Create a notification (called from other APIs)
 * Exported for use by follow endpoint, etc.
 */
export async function createNotification({ userId, actorId, type, title, message, data }) {
  try {
    await query(
      `INSERT INTO notifications (user_id, actor_id, type, title, message, data)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, actorId || null, type, title, message, data ? JSON.stringify(data) : null]
    )
    return true
  } catch (error) {
    console.error('Failed to create notification:', error)
    return false
  }
}

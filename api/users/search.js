/**
 * GET /api/users/search
 *
 * Search for users by username or display name
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne } from '../lib/db.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { q, limit = 20, offset = 0 } = req.query
    const currentUser = await getUserFromRequest(req)

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' })
    }

    const searchTerm = q.trim()
    const likePattern = `%${searchTerm}%`
    const limitNum = Math.min(parseInt(limit), 50)
    const offsetNum = parseInt(offset) || 0

    // Search for users by username or display_name
    let sql = `
      SELECT
        u.id,
        u.username,
        u.display_name,
        u.avatar_url,
        (SELECT COUNT(*) FROM contributions WHERE user_id = u.id AND status IN ('approved', 'pending')) as contribution_count,
        (SELECT COUNT(*) FROM follows WHERE following_id = u.id) as follower_count
    `

    // If logged in, check if current user follows each result
    if (currentUser) {
      sql += `,
        (SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id) as is_following
      `
    }

    sql += `
      FROM users u
      WHERE u.username IS NOT NULL
      AND (
        u.username LIKE ?
        OR u.display_name LIKE ?
      )
    `

    // Exclude current user from results
    if (currentUser) {
      sql += ` AND u.id != ?`
    }

    sql += `
      ORDER BY
        CASE
          WHEN u.username = ? THEN 1
          WHEN u.username LIKE ? THEN 2
          ELSE 3
        END,
        follower_count DESC
      LIMIT ? OFFSET ?
    `

    const startsWith = `${searchTerm}%`
    const params = currentUser
      ? [currentUser.id, likePattern, likePattern, currentUser.id, searchTerm, startsWith, limitNum, offsetNum]
      : [likePattern, likePattern, searchTerm, startsWith, limitNum, offsetNum]

    const users = await query(sql, params)

    // Get total count for pagination
    let countSql = `
      SELECT COUNT(*) as total FROM users u
      WHERE u.username IS NOT NULL
      AND (u.username LIKE ? OR u.display_name LIKE ?)
    `
    const countParams = [likePattern, likePattern]

    if (currentUser) {
      countSql += ` AND u.id != ?`
      countParams.push(currentUser.id)
    }

    const countResult = await queryOne(countSql, countParams)

    return res.status(200).json({
      users: users.map(u => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        avatarUrl: u.avatar_url,
        contributionCount: u.contribution_count,
        followerCount: u.follower_count,
        isFollowing: !!u.is_following
      })),
      total: countResult.total,
      hasMore: offsetNum + users.length < countResult.total
    })
  } catch (error) {
    console.error('User search error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * GET /api/auth/me
 *
 * Get current authenticated user.
 */

import { getUserFromRequest } from '../lib/auth.js'

export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const user = await getUserFromRequest(req)

    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        emailVerified: user.email_verified,
        createdAt: user.created_at
      }
    })
  } catch (error) {
    console.error('Get user error:', error)
    return res.status(500).json({ error: 'Failed to get user' })
  }
}

/**
 * GET /api/auth/me
 *
 * Get current authenticated user.
 */

import { getUserFromRequest, extractToken, verifyToken } from '../lib/auth.js'

export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Debug: Log what we're receiving
    const cookieHeader = req.headers.cookie
    const token = extractToken(req)
    const payload = token ? verifyToken(token) : null

    console.log('Auth debug:', {
      hasCookieHeader: !!cookieHeader,
      cookieHeaderLength: cookieHeader?.length,
      hasRoamToken: cookieHeader?.includes('roam_token='),
      extractedTokenLength: token?.length,
      tokenValid: !!payload,
      payloadUserId: payload?.userId
    })

    const user = await getUserFromRequest(req)

    if (!user) {
      return res.status(401).json({
        error: 'Not authenticated',
        debug: {
          hasCookie: !!cookieHeader,
          hasToken: !!token,
          tokenValid: !!payload
        }
      })
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

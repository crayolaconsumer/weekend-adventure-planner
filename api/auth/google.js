/* global process */
/**
 * POST /api/auth/google
 *
 * Authenticate or register user via Google OAuth.
 * Expects Google ID token from client-side Google Sign-In.
 */

import { OAuth2Client } from 'google-auth-library'
import { queryOne, insert, update } from '../lib/db.js'
import { generateToken, createAuthCookie, generateUsername } from '../lib/auth.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Check if Google OAuth is configured
  if (!GOOGLE_CLIENT_ID) {
    return res.status(501).json({
      error: 'Google sign-in is not configured'
    })
  }

  try {
    const { credential, accessToken, userInfo } = req.body

    let googleId, email, emailVerified, displayName, avatarUrl

    if (credential && typeof credential === 'string') {
      // ID Token flow (from One Tap)
      const client = new OAuth2Client(GOOGLE_CLIENT_ID)
      let ticket
      try {
        ticket = await client.verifyIdToken({
          idToken: credential,
          audience: GOOGLE_CLIENT_ID
        })
      } catch {
        return res.status(401).json({ error: 'Invalid Google credential' })
      }

      const payload = ticket.getPayload()
      googleId = payload.sub
      email = payload.email
      emailVerified = payload.email_verified
      displayName = payload.name
      avatarUrl = payload.picture
    } else if (accessToken && userInfo) {
      // Access Token flow (from popup)
      // Verify the access token by checking userinfo endpoint response
      if (!userInfo.sub || !userInfo.email) {
        return res.status(400).json({ error: 'Invalid Google user info' })
      }

      googleId = userInfo.sub
      email = userInfo.email
      emailVerified = userInfo.email_verified ?? true
      displayName = userInfo.name
      avatarUrl = userInfo.picture
    } else {
      return res.status(400).json({ error: 'Google credential is required' })
    }

    // Check if user exists by Google ID
    let user = await queryOne(
      'SELECT id, email, username, display_name, avatar_url, email_verified, google_id FROM users WHERE google_id = ?',
      [googleId]
    )

    if (!user) {
      // Check if email already exists (might have registered with email/password)
      user = await queryOne(
        'SELECT id, email, username, display_name, avatar_url, email_verified, google_id FROM users WHERE email = ?',
        [email.toLowerCase()]
      )

      if (user) {
        // Link Google account to existing user
        await update(
          `UPDATE users SET
            google_id = ?,
            email_verified = ?,
            avatar_url = COALESCE(avatar_url, ?),
            display_name = COALESCE(display_name, ?),
            last_login_at = NOW()
          WHERE id = ?`,
          [googleId, emailVerified, avatarUrl, displayName, user.id]
        )

        // Refresh user data
        user = await queryOne(
          'SELECT id, email, username, display_name, avatar_url, email_verified FROM users WHERE id = ?',
          [user.id]
        )
      } else {
        // Create new user
        const username = await generateUsername(email)

        const userId = await insert(
          `INSERT INTO users (email, google_id, username, display_name, avatar_url, email_verified, last_login_at)
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [email.toLowerCase(), googleId, username, displayName, avatarUrl, emailVerified]
        )

        user = await queryOne(
          'SELECT id, email, username, display_name, avatar_url, email_verified FROM users WHERE id = ?',
          [userId]
        )
      }
    } else {
      // Update last login and refresh profile data
      await update(
        `UPDATE users SET
          last_login_at = NOW(),
          avatar_url = COALESCE(?, avatar_url),
          display_name = COALESCE(display_name, ?)
        WHERE id = ?`,
        [avatarUrl, displayName, user.id]
      )
    }

    // Generate token
    const token = generateToken(user)

    // Set cookie
    res.setHeader('Set-Cookie', createAuthCookie(token, true))

    // Return user data
    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        emailVerified: user.email_verified
      },
      token,
      isNewUser: !user.last_login_at
    })
  } catch (error) {
    console.error('Google auth error:', error)
    return res.status(500).json({ error: 'Failed to authenticate with Google' })
  }
}

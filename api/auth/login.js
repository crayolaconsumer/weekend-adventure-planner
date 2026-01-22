/**
 * POST /api/auth/login
 *
 * Authenticate user with email and password.
 */

import { queryOne, update } from '../lib/db.js'
import {
  comparePassword,
  generateToken,
  createAuthCookie,
  isValidEmail
} from '../lib/auth.js'

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { email, password, remember = false } = req.body

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' })
    }

    // Find user
    const user = await queryOne(
      'SELECT id, email, password_hash, username, display_name, avatar_url, email_verified, google_id FROM users WHERE email = ?',
      [email.toLowerCase()]
    )

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    // Check if user has password (might be Google-only account)
    if (!user.password_hash) {
      if (user.google_id) {
        return res.status(401).json({
          error: 'This account uses Google sign-in. Please sign in with Google.'
        })
      }
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    // Verify password
    const isValid = await comparePassword(password, user.password_hash)
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    // Update last login
    await update(
      'UPDATE users SET last_login_at = NOW() WHERE id = ?',
      [user.id]
    )

    // Generate token
    const token = generateToken(user)

    // Set cookie
    res.setHeader('Set-Cookie', createAuthCookie(token, remember))

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
      token
    })
  } catch (error) {
    console.error('Login error:', error)
    return res.status(500).json({ error: 'Failed to sign in' })
  }
}

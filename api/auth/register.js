/**
 * POST /api/auth/register
 *
 * Register a new user with email and password.
 */

import { queryOne, insert } from '../lib/db.js'
import {
  hashPassword,
  generateToken,
  createAuthCookie,
  isValidEmail,
  validatePassword,
  generateUsername
} from '../lib/auth.js'

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { email, password, displayName } = req.body

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' })
    }

    const passwordValidation = validatePassword(password)
    if (!passwordValidation.valid) {
      return res.status(400).json({ error: passwordValidation.message })
    }

    // Check if email already exists
    const existingUser = await queryOne(
      'SELECT id FROM users WHERE email = ?',
      [email.toLowerCase()]
    )

    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists' })
    }

    // Hash password
    const passwordHash = await hashPassword(password)

    // Generate unique username
    const username = await generateUsername(email)

    // Create user
    const userId = await insert(
      `INSERT INTO users (email, password_hash, username, display_name, email_verified)
       VALUES (?, ?, ?, ?, FALSE)`,
      [email.toLowerCase(), passwordHash, username, displayName || null]
    )

    // Fetch created user
    const user = await queryOne(
      'SELECT id, email, username, display_name, avatar_url, email_verified, created_at FROM users WHERE id = ?',
      [userId]
    )

    // Generate token
    const token = generateToken(user)

    // Set cookie
    res.setHeader('Set-Cookie', createAuthCookie(token))

    // Return user data (without sensitive fields)
    return res.status(201).json({
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
    console.error('Registration error:', error)
    return res.status(500).json({ error: 'Failed to create account' })
  }
}

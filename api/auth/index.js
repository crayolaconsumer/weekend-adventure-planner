/* global process */
/**
 * POST/GET /api/auth
 *
 * Consolidated auth endpoint. Routes based on `action` field in POST body.
 *
 * GET - Get current user (was /me)
 * POST actions:
 *   - login: Email/password login
 *   - register: Create new account
 *   - google: Google OAuth
 *   - logout: Clear auth cookie
 */

import { OAuth2Client } from 'google-auth-library'
import { queryOne, insert, update } from '../lib/db.js'
import {
  hashPassword,
  comparePassword,
  generateToken,
  createAuthCookie,
  createLogoutCookie,
  isValidEmail,
  validatePassword,
  generateUsername,
  getUserFromRequest,
  extractToken,
  verifyToken
} from '../lib/auth.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID

export default async function handler(req, res) {
  try {
    switch (req.method) {
      case 'GET':
        return await handleGetMe(req, res)
      case 'POST': {
        const { action } = req.body || {}
        switch (action) {
          case 'login':
            return await handleLogin(req, res)
          case 'register':
            return await handleRegister(req, res)
          case 'google':
            return await handleGoogle(req, res)
          case 'logout':
            return await handleLogout(req, res)
          case 'update':
            return await handleUpdateProfile(req, res)
          default:
            return res.status(400).json({ error: 'Invalid action. Use: login, register, google, logout, or update' })
        }
      }
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('Auth error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * GET - Get current authenticated user
 */
async function handleGetMe(req, res) {
  const user = await getUserFromRequest(req)

  if (!user) {
    return res.status(401).json({
      error: 'Not authenticated'
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
      createdAt: user.created_at,
      tier: user.tier,
      subscription_id: user.subscription_id,
      subscription_expires_at: user.subscription_expires_at,
      subscription_cancelled_at: user.subscription_cancelled_at,
      stripe_customer_id: user.stripe_customer_id
    }
  })
}

/**
 * POST action=login - Email/password login
 */
async function handleLogin(req, res) {
  // Rate limit login attempts
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.AUTH_LOGIN, 'login')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const { email, password, remember = false } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' })
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Invalid email format' })
  }

  const user = await queryOne(
    'SELECT id, email, password_hash, username, display_name, avatar_url, email_verified, google_id, tier, subscription_id, subscription_expires_at, subscription_cancelled_at, stripe_customer_id FROM users WHERE email = ?',
    [email.toLowerCase()]
  )

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  if (!user.password_hash) {
    if (user.google_id) {
      return res.status(401).json({
        error: 'This account uses Google sign-in. Please sign in with Google.'
      })
    }
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  const isValid = await comparePassword(password, user.password_hash)
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  await update('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id])

  const token = generateToken(user)
  res.setHeader('Set-Cookie', createAuthCookie(token, remember))

  return res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      emailVerified: user.email_verified,
      tier: user.tier,
      subscription_id: user.subscription_id,
      subscription_expires_at: user.subscription_expires_at,
      subscription_cancelled_at: user.subscription_cancelled_at,
      stripe_customer_id: user.stripe_customer_id
    },
    token
  })
}

/**
 * POST action=register - Create new account
 */
async function handleRegister(req, res) {
  // Rate limit registration attempts
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.AUTH_REGISTER, 'register')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const { email, password, displayName } = req.body

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

  // M4: Validate displayName length on register
  if (displayName !== undefined && displayName !== null) {
    if (typeof displayName !== 'string') {
      return res.status(400).json({ error: 'Display name must be a string' })
    }
    if (displayName.length > 50) {
      return res.status(400).json({ error: 'Display name must be 50 characters or less' })
    }
    // Check for potentially malicious content
    if (/<script|javascript:|data:/i.test(displayName)) {
      return res.status(400).json({ error: 'Display name contains invalid characters' })
    }
  }

  const existingUser = await queryOne(
    'SELECT id FROM users WHERE email = ?',
    [email.toLowerCase()]
  )

  if (existingUser) {
    // Generic message to prevent email enumeration
    // In production, consider sending a "someone tried to register" email to the existing user
    return res.status(400).json({ error: 'Unable to create account. Please try signing in instead.' })
  }

  const passwordHash = await hashPassword(password)
  const username = await generateUsername(email)

  const userId = await insert(
    `INSERT INTO users (email, password_hash, username, display_name, email_verified)
     VALUES (?, ?, ?, ?, FALSE)`,
    [email.toLowerCase(), passwordHash, username, displayName || null]
  )

  const user = await queryOne(
    'SELECT id, email, username, display_name, avatar_url, email_verified, created_at, tier, subscription_id, subscription_expires_at, subscription_cancelled_at, stripe_customer_id FROM users WHERE id = ?',
    [userId]
  )

  const token = generateToken(user)
  res.setHeader('Set-Cookie', createAuthCookie(token))

  return res.status(201).json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      emailVerified: user.email_verified,
      tier: user.tier,
      subscription_id: user.subscription_id,
      subscription_expires_at: user.subscription_expires_at,
      subscription_cancelled_at: user.subscription_cancelled_at,
      stripe_customer_id: user.stripe_customer_id
    },
    token
  })
}

/**
 * POST action=google - Google OAuth
 */
async function handleGoogle(req, res) {
  // Rate limit Google auth attempts
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.AUTH_GOOGLE, 'google')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  if (!GOOGLE_CLIENT_ID) {
    return res.status(501).json({ error: 'Google sign-in is not configured' })
  }

  const { credential, accessToken } = req.body

  let googleId, email, emailVerified, displayName, avatarUrl

  if (credential && typeof credential === 'string') {
    // ID Token flow - verify with Google
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
  } else if (accessToken && typeof accessToken === 'string') {
    // Access Token flow - MUST validate with Google's userinfo API
    // NEVER trust client-provided userInfo
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      })

      if (!response.ok) {
        return res.status(401).json({ error: 'Invalid Google access token' })
      }

      const userInfo = await response.json()

      if (!userInfo.sub || !userInfo.email) {
        return res.status(401).json({ error: 'Invalid Google user info' })
      }

      googleId = userInfo.sub
      email = userInfo.email
      emailVerified = userInfo.email_verified ?? false
      displayName = userInfo.name
      avatarUrl = userInfo.picture
    } catch {
      return res.status(401).json({ error: 'Failed to verify Google access token' })
    }
  } else {
    return res.status(400).json({ error: 'Google credential or access token is required' })
  }

  let user = await queryOne(
    'SELECT id, email, username, display_name, avatar_url, email_verified, google_id, last_login_at, tier, subscription_id, subscription_expires_at, subscription_cancelled_at, stripe_customer_id FROM users WHERE google_id = ?',
    [googleId]
  )

  if (!user) {
    user = await queryOne(
      'SELECT id, email, username, display_name, avatar_url, email_verified, google_id, tier, subscription_id, subscription_expires_at, subscription_cancelled_at, stripe_customer_id FROM users WHERE email = ?',
      [email.toLowerCase()]
    )

    if (user) {
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

      user = await queryOne(
        'SELECT id, email, username, display_name, avatar_url, email_verified, tier, subscription_id, subscription_expires_at, subscription_cancelled_at, stripe_customer_id FROM users WHERE id = ?',
        [user.id]
      )
    } else {
      const username = await generateUsername(email)

      const userId = await insert(
        `INSERT INTO users (email, google_id, username, display_name, avatar_url, email_verified, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [email.toLowerCase(), googleId, username, displayName, avatarUrl, emailVerified]
      )

      user = await queryOne(
        'SELECT id, email, username, display_name, avatar_url, email_verified, tier, subscription_id, subscription_expires_at, subscription_cancelled_at, stripe_customer_id FROM users WHERE id = ?',
        [userId]
      )
    }
  } else {
    await update(
      `UPDATE users SET
        last_login_at = NOW(),
        avatar_url = COALESCE(?, avatar_url),
        display_name = COALESCE(display_name, ?)
      WHERE id = ?`,
      [avatarUrl, displayName, user.id]
    )
  }

  const token = generateToken(user)
  const cookie = createAuthCookie(token, true)
  res.setHeader('Set-Cookie', cookie)

  return res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      emailVerified: user.email_verified,
      tier: user.tier,
      subscription_id: user.subscription_id,
      subscription_expires_at: user.subscription_expires_at,
      subscription_cancelled_at: user.subscription_cancelled_at,
      stripe_customer_id: user.stripe_customer_id
    },
    token,
    isNewUser: !user.last_login_at
  })
}

/**
 * POST action=logout - Clear auth cookie
 */
async function handleLogout(req, res) {
  res.setHeader('Set-Cookie', createLogoutCookie())
  return res.status(200).json({ success: true })
}

/**
 * POST action=update - Update user profile
 */
async function handleUpdateProfile(req, res) {
  const user = await getUserFromRequest(req)

  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  // SECURITY: Whitelist allowed fields to prevent SQL injection via dynamic field names
  const ALLOWED_FIELDS = ['displayName', 'username', 'avatarUrl']
  const sanitizedBody = {}
  for (const field of ALLOWED_FIELDS) {
    if (req.body[field] !== undefined) {
      sanitizedBody[field] = req.body[field]
    }
  }

  const { displayName, username, avatarUrl } = sanitizedBody

  // Validate username if provided
  if (username !== undefined) {
    if (!username || username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' })
    }
    if (username.length > 30) {
      return res.status(400).json({ error: 'Username must be 30 characters or less' })
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' })
    }

    // Check if username is taken by another user
    const existingUser = await queryOne(
      'SELECT id FROM users WHERE username = ? AND id != ?',
      [username.toLowerCase(), user.id]
    )
    if (existingUser) {
      return res.status(409).json({ error: 'Username is already taken' })
    }
  }

  // Validate display name if provided
  if (displayName !== undefined) {
    if (displayName && displayName.length > 50) {
      return res.status(400).json({ error: 'Display name must be 50 characters or less' })
    }
  }

  // Build update query dynamically based on provided fields
  const updates = []
  const values = []

  if (displayName !== undefined) {
    updates.push('display_name = ?')
    values.push(displayName || null)
  }

  if (username !== undefined) {
    updates.push('username = ?')
    values.push(username.toLowerCase())
  }

  // M5: Validate avatarUrl format and length
  if (avatarUrl !== undefined) {
    if (avatarUrl !== null && avatarUrl !== '') {
      if (typeof avatarUrl !== 'string') {
        return res.status(400).json({ error: 'Avatar URL must be a string' })
      }
      if (avatarUrl.length > 500) {
        return res.status(400).json({ error: 'Avatar URL must be 500 characters or less' })
      }
      // Only allow http/https URLs
      if (!/^https?:\/\//i.test(avatarUrl)) {
        return res.status(400).json({ error: 'Avatar URL must be a valid HTTP/HTTPS URL' })
      }
      // Block javascript: and data: URLs
      if (/^(javascript|data):/i.test(avatarUrl)) {
        return res.status(400).json({ error: 'Invalid avatar URL format' })
      }
    }
    updates.push('avatar_url = ?')
    values.push(avatarUrl || null)
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' })
  }

  values.push(user.id)

  await update(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
    values
  )

  // Fetch updated user
  const updatedUser = await queryOne(
    'SELECT id, email, username, display_name, avatar_url, email_verified, tier, subscription_id, subscription_expires_at, subscription_cancelled_at, stripe_customer_id FROM users WHERE id = ?',
    [user.id]
  )

  return res.status(200).json({
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      username: updatedUser.username,
      displayName: updatedUser.display_name,
      avatarUrl: updatedUser.avatar_url,
      emailVerified: updatedUser.email_verified,
      tier: updatedUser.tier,
      subscription_id: updatedUser.subscription_id,
      subscription_expires_at: updatedUser.subscription_expires_at,
      subscription_cancelled_at: updatedUser.subscription_cancelled_at,
      stripe_customer_id: updatedUser.stripe_customer_id
    }
  })
}

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
          default:
            return res.status(400).json({ error: 'Invalid action. Use: login, register, google, or logout' })
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

  const existingUser = await queryOne(
    'SELECT id FROM users WHERE email = ?',
    [email.toLowerCase()]
  )

  if (existingUser) {
    return res.status(409).json({ error: 'An account with this email already exists' })
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
  if (!GOOGLE_CLIENT_ID) {
    return res.status(501).json({ error: 'Google sign-in is not configured' })
  }

  const { credential, accessToken, userInfo } = req.body

  let googleId, email, emailVerified, displayName, avatarUrl

  if (credential && typeof credential === 'string') {
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
  console.log('Setting cookie:', cookie.substring(0, 50) + '...')
  res.setHeader('Set-Cookie', cookie)

  return res.status(200).json({
    debug: {
      cookieSet: true,
      cookieLength: cookie.length,
      tokenLength: token.length
    },
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

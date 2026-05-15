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
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { queryOne, insert, update, transaction } from '../lib/db.js'
import {
  hashPassword,
  comparePassword,
  generateToken,
  createAuthCookie,
  createLogoutCookie,
  isValidEmail,
  validatePassword,
  generateUsername,
  getUserFromRequest
} from '../lib/auth.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'

// Trim env vars — Vercel dashboard sometimes appends trailing whitespace/newlines
// when the value is pasted with a return key. That broke audience validation
// previously (the verifier saw 'com.goroam.app.signin\n' instead of the bare ID).
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim()
const APPLE_SERVICES_ID = process.env.APPLE_SIGNIN_SERVICES_ID?.trim()
const APPLE_BUNDLE_ID = (process.env.APPLE_BUNDLE_ID || 'com.goroam.app').trim()

// Apple's public keys, fetched + cached + auto-rotated by jose
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'))

// Capacitor native iOS/Android use Bearer-token auth and never read cookies
// (the WKWebView cookie jar is partitioned away from the capacitor:// origin).
// Emitting Set-Cookie on these responses combined with the CORS preflight
// trips WKWebView's cookie-acceptance policy and aborts the response with
// the opaque "TypeError: Load failed" — which is what was killing every
// /api/auth POST from the iOS app. Web origins still set cookies normally.
function isCapacitorOrigin(req) {
  const origin = req.headers?.origin
  return origin === 'capacitor://localhost' || origin === 'https://localhost'
}

function setAuthCookie(req, res, token, remember = false) {
  if (isCapacitorOrigin(req)) return
  res.setHeader('Set-Cookie', createAuthCookie(token, remember))
}

function clearAuthCookie(req, res) {
  if (isCapacitorOrigin(req)) return
  res.setHeader('Set-Cookie', createLogoutCookie())
}

// Safely read req.body. Vercel's stricter @vercel/node runtime throws
// synchronously from the `req.body` getter when the body is missing,
// malformed JSON, or has an unexpected Content-Type — and `req.body || {}`
// doesn't catch the throw because the throw happens before the `||`
// evaluates. Wrap once here so a bad body becomes a clean 400 instead of
// a generic 500 (and so the rest of the handler can rely on req.body
// being a plain object or null).
function safeBody(req) {
  try {
    return req.body ?? null
  } catch {
    return null
  }
}

async function handler(req, res) {
  try {
    switch (req.method) {
      case 'GET':
        return await handleGetMe(req, res)
      case 'POST': {
        const body = safeBody(req)
        if (!body || typeof body !== 'object') {
          return res.status(400).json({ error: 'Request body must be JSON' })
        }
        // Mutate req.body so downstream handlers can keep reading from
        // the conventional location without each needing their own guard.
        req.body = body
        const { action } = body
        switch (action) {
          case 'login':
            return await handleLogin(req, res)
          case 'register':
            return await handleRegister(req, res)
          case 'google':
            return await handleGoogle(req, res)
          case 'apple':
            return await handleApple(req, res)
          case 'logout':
            return await handleLogout(req, res)
          case 'update':
            return await handleUpdateProfile(req, res)
          case 'delete':
            return await handleDeleteAccount(req, res)
          default:
            return res.status(400).json({ error: 'Invalid action. Use: login, register, google, apple, logout, update, or delete' })
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
      isAdmin: user.is_admin === true,
      subscription_expires_at: user.subscription_expires_at,
      subscription_cancelled_at: user.subscription_cancelled_at,
      subscription_source: user.subscription_source
      // stripe_customer_id and subscription_id deliberately omitted —
      // internal payment-processor identifiers that the client never
      // needs and shouldn't be able to probe with.
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
    'SELECT id, email, password_hash, username, display_name, avatar_url, email_verified, google_id, tier, is_banned, subscription_id, subscription_expires_at, subscription_cancelled_at, subscription_source, stripe_customer_id FROM users WHERE email = ?',
    [email.toLowerCase()]
  )

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  // Banned accounts get the generic invalid-credentials response so
  // we don't confirm to attackers that the email maps to an account.
  if (user.is_banned) {
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
  setAuthCookie(req, res, token, remember)

  return res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      emailVerified: user.email_verified,
      tier: user.tier,
      subscription_expires_at: user.subscription_expires_at,
      subscription_cancelled_at: user.subscription_cancelled_at,
      subscription_source: user.subscription_source
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
    // Reject email-shaped display names (people sometimes paste their email here)
    if (displayName.includes('@')) {
      return res.status(400).json({ error: 'Display name should be your name, not your email' })
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
    'SELECT id, email, username, display_name, avatar_url, email_verified, created_at, tier, subscription_id, subscription_expires_at, subscription_cancelled_at, subscription_source, stripe_customer_id FROM users WHERE id = ?',
    [userId]
  )

  const token = generateToken(user)
  setAuthCookie(req, res, token)

  return res.status(201).json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      emailVerified: user.email_verified,
      tier: user.tier,
      subscription_expires_at: user.subscription_expires_at,
      subscription_cancelled_at: user.subscription_cancelled_at,
      subscription_source: user.subscription_source
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
    // Defensive: Google can return an email-shaped name in rare cases
    displayName = (typeof payload.name === 'string' && !payload.name.includes('@')) ? payload.name : null
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
      displayName = (typeof userInfo.name === 'string' && !userInfo.name.includes('@')) ? userInfo.name : null
      avatarUrl = userInfo.picture
    } catch {
      return res.status(401).json({ error: 'Failed to verify Google access token' })
    }
  } else {
    return res.status(400).json({ error: 'Google credential or access token is required' })
  }

  let user = await queryOne(
    'SELECT id, email, username, display_name, avatar_url, email_verified, google_id, apple_id, last_login_at, tier, subscription_id, subscription_expires_at, subscription_cancelled_at, subscription_source, stripe_customer_id FROM users WHERE google_id = ?',
    [googleId]
  )

  if (!user) {
    user = await queryOne(
      'SELECT id, email, username, display_name, avatar_url, email_verified, google_id, tier, subscription_id, subscription_expires_at, subscription_cancelled_at, subscription_source, stripe_customer_id FROM users WHERE email = ?',
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
        'SELECT id, email, username, display_name, avatar_url, email_verified, tier, subscription_id, subscription_expires_at, subscription_cancelled_at, subscription_source, stripe_customer_id FROM users WHERE id = ?',
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
        'SELECT id, email, username, display_name, avatar_url, email_verified, tier, subscription_id, subscription_expires_at, subscription_cancelled_at, subscription_source, stripe_customer_id FROM users WHERE id = ?',
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
  setAuthCookie(req, res, token, true)

  return res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      emailVerified: user.email_verified,
      tier: user.tier,
      subscription_expires_at: user.subscription_expires_at,
      subscription_cancelled_at: user.subscription_cancelled_at,
      subscription_source: user.subscription_source
    },
    token,
    isNewUser: !user.last_login_at
  })
}

/**
 * POST action=apple - Sign in with Apple
 *
 * Body shape:
 *   { action: 'apple', identityToken: '<JWT>', userInfo?: { name?: { firstName, lastName } } }
 *
 * Apple sends the user's full name ONLY on first sign-in, and only via
 * the client (it's NOT in the identity token claims). The client must
 * capture it on the first sign-in event and forward it here. Subsequent
 * sign-ins won't have it — that's expected; we already have it stored.
 *
 * The identity token's `aud` claim is:
 *   - Services ID (e.g. com.goroam.app.signin) for web flow
 *   - Bundle ID (com.goroam.app) for native iOS via Capacitor plugin
 * We accept both.
 */
async function handleApple(req, res) {
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.AUTH_GOOGLE, 'apple')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  if (!APPLE_SERVICES_ID) {
    return res.status(501).json({ error: 'Sign in with Apple is not configured' })
  }

  const { identityToken, userInfo } = req.body
  if (!identityToken || typeof identityToken !== 'string') {
    return res.status(400).json({ error: 'Apple identity token is required' })
  }

  // Verify the JWT — checks signature against Apple's JWKS, expiry,
  // issuer, and audience all in one shot.
  let payload
  try {
    const verified = await jwtVerify(identityToken, APPLE_JWKS, {
      issuer: 'https://appleid.apple.com',
      audience: [APPLE_SERVICES_ID, APPLE_BUNDLE_ID],
    })
    payload = verified.payload
  } catch (err) {
    // Log enough to diagnose without dumping the full token. jose
    // error codes are stable: ERR_JWT_CLAIM_VALIDATION_FAILED (with
    // claim name) covers the common audience/issuer mismatches.
    // Previous catch swallowed everything — user reported a 401 with
    // no logs and we had nothing to debug.
    let aud = null, iss = null, decodeError = null
    const parts = identityToken.split('.')
    try {
      if (parts.length === 3) {
        const claimsJson = Buffer.from(parts[1], 'base64').toString('utf8')
        const claims = JSON.parse(claimsJson)
        aud = claims.aud
        iss = claims.iss
      }
    } catch (decodeErr) {
      decodeError = decodeErr?.message
    }
    // Do NOT log prefix/suffix of the token — the prefix is the JWS
    // header + start of payload (includes key ID), the suffix is the
    // tail of the signature. Length + parts + decoded aud/iss are
    // enough to diagnose every realistic failure mode without
    // shipping pieces of a real identity token into log storage.
    console.error('[apple-auth] JWT verification failed', {
      code: err?.code,
      message: err?.message,
      claim: err?.claim,
      reason: err?.reason,
      token_aud: aud,
      token_iss: iss,
      token_length: identityToken.length,
      token_parts: parts.length,
      decode_error: decodeError,
      expected_audiences: [APPLE_SERVICES_ID, APPLE_BUNDLE_ID],
    })
    return res.status(401).json({ error: 'Invalid Apple identity token' })
  }

  const appleId = payload.sub
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true'
  // Apple's "private email relay" — privaterelay.appleid.com — fine to accept,
  // counts as verified since Apple owns the relay.
  const isPrivateEmail = payload.is_private_email === true || payload.is_private_email === 'true'

  if (!appleId) {
    return res.status(401).json({ error: 'Apple token missing subject' })
  }

  // Extract display name from first-sign-in user info (client-provided)
  let displayName = null
  if (userInfo?.name && typeof userInfo.name === 'object') {
    const first = typeof userInfo.name.firstName === 'string' ? userInfo.name.firstName : ''
    const last = typeof userInfo.name.lastName === 'string' ? userInfo.name.lastName : ''
    const combined = `${first} ${last}`.trim()
    // Defensive: reject email-shaped names to match the Google handler convention
    if (combined && !combined.includes('@')) displayName = combined.slice(0, 100)
  }

  // Look up by apple_id first
  let user = await queryOne(
    'SELECT id, email, username, display_name, avatar_url, email_verified, google_id, apple_id, last_login_at, tier, subscription_id, subscription_expires_at, subscription_cancelled_at, subscription_source, stripe_customer_id FROM users WHERE apple_id = ?',
    [appleId]
  )

  if (!user) {
    // Fall back to email match — link existing account if user previously
    // signed up with email or Google using the same address. Apple's email
    // is verified so this is safe to auto-link.
    if (email) {
      user = await queryOne(
        'SELECT id, email, username, display_name, avatar_url, email_verified, google_id, apple_id, tier, subscription_id, subscription_expires_at, subscription_cancelled_at, subscription_source, stripe_customer_id FROM users WHERE email = ?',
        [email]
      )
    }

    if (user) {
      // Existing account — link Apple ID to it
      await update(
        `UPDATE users SET
          apple_id = ?,
          email_verified = ?,
          display_name = COALESCE(display_name, ?),
          last_login_at = NOW()
        WHERE id = ?`,
        [appleId, emailVerified || isPrivateEmail, displayName, user.id]
      )

      user = await queryOne(
        'SELECT id, email, username, display_name, avatar_url, email_verified, tier, subscription_id, subscription_expires_at, subscription_cancelled_at, subscription_source, stripe_customer_id FROM users WHERE id = ?',
        [user.id]
      )
    } else {
      // Brand new user
      if (!email) {
        return res.status(400).json({ error: 'No email available — Apple did not share an email address' })
      }
      const username = await generateUsername(email)

      const userId = await insert(
        `INSERT INTO users (email, apple_id, username, display_name, email_verified, last_login_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [email, appleId, username, displayName, emailVerified || isPrivateEmail]
      )

      user = await queryOne(
        'SELECT id, email, username, display_name, avatar_url, email_verified, tier, subscription_id, subscription_expires_at, subscription_cancelled_at, subscription_source, stripe_customer_id FROM users WHERE id = ?',
        [userId]
      )
    }
  } else {
    // Existing Apple-linked user, just refresh last_login + name if newly provided
    await update(
      `UPDATE users SET
        last_login_at = NOW(),
        display_name = COALESCE(display_name, ?)
      WHERE id = ?`,
      [displayName, user.id]
    )
  }

  const token = generateToken(user)
  setAuthCookie(req, res, token, true)

  return res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      emailVerified: user.email_verified,
      tier: user.tier,
      subscription_expires_at: user.subscription_expires_at,
      subscription_cancelled_at: user.subscription_cancelled_at,
      subscription_source: user.subscription_source
    },
    token,
    isNewUser: !user.last_login_at
  })
}

/**
 * POST action=logout - Clear auth cookie
 */
async function handleLogout(req, res) {
  clearAuthCookie(req, res)
  return res.status(200).json({ success: true })
}

/**
 * POST action=delete — Permanently delete the authenticated user's account.
 *
 * App Store Review Guideline 5.1.1(v) requires apps that support account
 * creation to also offer in-app account deletion (since iOS 14.5+, mid-2022).
 *
 * Body shape:
 *   { action: 'delete', confirmUsername: '<current username>' }
 *
 * The confirmUsername guard prevents accidental taps. We require a fresh
 * recent login (within 30 minutes) so a leaked session token can't trash
 * the account silently.
 *
 * Cancels any active Stripe subscription before deleting the row so the
 * user isn't billed after deletion.
 *
 * Cascades via FK ON DELETE CASCADE for: saved_places, collections,
 * contributions, visited_places, place_ratings, user_stats, user_privacy_
 * settings, push_subscriptions, refresh_tokens, follows, follow_requests,
 * blocked_users, notifications, content_reports, swiped_places.
 */
async function handleDeleteAccount(req, res) {
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.AUTH_LOGIN, 'delete')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  const { confirmUsername } = req.body || {}
  if (typeof confirmUsername !== 'string' || confirmUsername !== user.username) {
    return res.status(400).json({
      error: 'Please type your username to confirm account deletion'
    })
  }

  // Fresh-login check — require a login within the last 30 minutes for this
  // destructive action. last_login_at is updated on every login.
  const fresh = await queryOne(
    'SELECT last_login_at FROM users WHERE id = ?',
    [user.id]
  )
  const loginAge = fresh?.last_login_at
    ? (Date.now() - new Date(fresh.last_login_at).getTime()) / 60000
    : Infinity
  if (loginAge > 30) {
    return res.status(401).json({
      error: 'Please sign in again before deleting your account',
      code: 'STALE_SESSION'
    })
  }

  // Cancel any active Stripe subscription so the user isn't billed after
  // deletion. Best-effort — never block deletion if Stripe call fails.
  // Note: `user.stripe_subscription_id` was a typo — the column is
  // `subscription_id`. The corrected check covers either source.
  if (fresh?.stripe_customer_id || fresh?.subscription_id || user.subscription_id) {
    try {
      const subRow = await queryOne(
        'SELECT subscription_id FROM users WHERE id = ?',
        [user.id]
      )
      if (subRow?.subscription_id) {
        const { default: Stripe } = await import('stripe')
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
        await stripe.subscriptions.cancel(subRow.subscription_id).catch(() => {})
      }
    } catch (err) {
      console.warn('Stripe cancel during delete failed (continuing):', err?.message)
    }
  }

  // Hard delete in a single transaction. All dependent rows cascade via FK.
  try {
    await transaction(async (conn) => {
      // Belt-and-braces explicit deletes for tables that may lack FK cascade
      // (e.g. content_reports, swiped_places). Safe to no-op if rows absent.
      await conn.query('DELETE FROM swiped_places WHERE user_id = ?', [user.id])
      await conn.query('DELETE FROM content_reports WHERE reporter_id = ? OR reported_user_id = ?', [user.id, user.id]).catch(() => {})
      await conn.query('DELETE FROM users WHERE id = ?', [user.id])
    })
  } catch (err) {
    console.error('Account deletion failed:', err)
    return res.status(500).json({ error: 'Account deletion failed. Please contact hello@go-roam.uk' })
  }

  // Clear cookies and signal client to log out
  clearAuthCookie(req, res)
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
    if (displayName && typeof displayName === 'string' && displayName.includes('@')) {
      return res.status(400).json({ error: 'Display name should be your name, not your email' })
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
    'SELECT id, email, username, display_name, avatar_url, email_verified, tier, subscription_id, subscription_expires_at, subscription_cancelled_at, subscription_source, stripe_customer_id FROM users WHERE id = ?',
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
      subscription_expires_at: updatedUser.subscription_expires_at,
      subscription_cancelled_at: updatedUser.subscription_cancelled_at,
      subscription_source: updatedUser.subscription_source
    }
  })
}

export default withCors(handler)

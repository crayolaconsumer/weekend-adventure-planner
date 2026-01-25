/* global process */
/**
 * Authentication Utilities
 *
 * JWT token generation/verification and password hashing.
 */

import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { queryOne } from './db.js'

// CRITICAL: JWT_SECRET must be set in production
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set')
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be configured in production')
  }
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'dev-only-secret-not-for-production'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'
const SALT_ROUNDS = 10

/**
 * Hash a password
 * @param {string} password - Plain text password
 * @returns {Promise<string>} Hashed password
 */
export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS)
}

/**
 * Compare password with hash
 * @param {string} password - Plain text password
 * @param {string} hash - Stored hash
 * @returns {Promise<boolean>} True if match
 */
export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash)
}

/**
 * Generate JWT access token
 * @param {Object} user - User object
 * @returns {string} JWT token
 */
export function generateToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      username: user.username
    },
    EFFECTIVE_JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  )
}

/**
 * Verify JWT token
 * @param {string} token - JWT token
 * @returns {Object|null} Decoded payload or null if invalid
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, EFFECTIVE_JWT_SECRET)
  } catch {
    return null
  }
}

/**
 * Extract token from request
 * Checks Authorization header and cookies
 * @param {Request} req - HTTP request
 * @returns {string|null} Token or null
 */
export function extractToken(req) {
  // Check Authorization header (Node.js style - plain object)
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }

  // Check cookies
  const cookies = req.headers.cookie
  if (cookies) {
    const tokenCookie = cookies
      .split(';')
      .find(c => c.trim().startsWith('roam_token='))
    if (tokenCookie) {
      // Use substring to handle JWT tokens with = padding (base64)
      return tokenCookie.trim().substring(tokenCookie.indexOf('=') + 1)
    }
  }

  return null
}

/**
 * Get user from request (middleware helper)
 * @param {Request} req - HTTP request
 * @returns {Promise<Object|null>} User object or null
 */
export async function getUserFromRequest(req) {
  const token = extractToken(req)
  if (!token) return null

  const payload = verifyToken(token)
  if (!payload) return null

  const user = await queryOne(
    'SELECT id, email, username, display_name, avatar_url, email_verified, created_at, tier, stripe_customer_id, subscription_id, subscription_expires_at, subscription_cancelled_at FROM users WHERE id = ?',
    [payload.userId]
  )

  return user
}

/**
 * Create auth cookie string
 * @param {string} token - JWT token
 * @param {boolean} remember - If true, set longer expiry
 * @returns {string} Cookie string
 */
export function createAuthCookie(token, remember = false) {
  const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 7 // 30 days or 7 days
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1'
  const cookieDomain = process.env.AUTH_COOKIE_DOMAIN || process.env.COOKIE_DOMAIN
  const sameSite = (process.env.AUTH_COOKIE_SAMESITE || 'Lax').trim()
  const sameSiteValue = sameSite.charAt(0).toUpperCase() + sameSite.slice(1).toLowerCase()
  const secure = isProduction || sameSiteValue.toLowerCase() === 'none'

  // SameSite=Lax is correct for same-origin (frontend and API on same domain)
  // Secure flag required for HTTPS in production
  return `roam_token=${token}; Path=/; HttpOnly; SameSite=${sameSiteValue}; Max-Age=${maxAge}${secure ? '; Secure' : ''}${cookieDomain ? `; Domain=${cookieDomain}` : ''}`
}

/**
 * Create logout cookie (clears auth)
 * @returns {string} Cookie string that clears token
 */
export function createLogoutCookie() {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1'
  const cookieDomain = process.env.AUTH_COOKIE_DOMAIN || process.env.COOKIE_DOMAIN
  const sameSite = (process.env.AUTH_COOKIE_SAMESITE || 'Lax').trim()
  const sameSiteValue = sameSite.charAt(0).toUpperCase() + sameSite.slice(1).toLowerCase()
  const secure = isProduction || sameSiteValue.toLowerCase() === 'none'

  return `roam_token=; Path=/; HttpOnly; SameSite=${sameSiteValue}; Max-Age=0${secure ? '; Secure' : ''}${cookieDomain ? `; Domain=${cookieDomain}` : ''}`
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid
 */
export function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {{valid: boolean, message: string}} Validation result
 */
export function validatePassword(password) {
  if (!password || password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters' }
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain a lowercase letter' }
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain an uppercase letter' }
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain a number' }
  }
  return { valid: true, message: '' }
}

/**
 * Generate unique username from email
 * @param {string} email - User email
 * @returns {Promise<string>} Unique username
 */
export async function generateUsername(email) {
  const base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '')
  let username = base.slice(0, 20)
  let attempts = 0

  while (attempts < 100) {
    const suffix = attempts > 0 ? Math.floor(Math.random() * 10000) : ''
    const candidate = `${username}${suffix}`.slice(0, 50)

    const existing = await queryOne(
      'SELECT id FROM users WHERE username = ?',
      [candidate]
    )

    if (!existing) {
      return candidate
    }
    attempts++
  }

  // Fallback: use timestamp
  return `${username}${Date.now()}`.slice(0, 50)
}

/**
 * Check if user has premium tier
 * @param {Object} user - User object from getUserFromRequest
 * @returns {boolean}
 */
export function isPremiumUser(user) {
  if (!user) return false
  return user.tier === 'premium'
}

/**
 * Get user's feature limits based on tier
 * @param {Object} user - User object
 * @returns {Object} limits
 */
export function getUserLimits(user) {
  const isPremium = isPremiumUser(user)
  return {
    maxSavedPlaces: isPremium ? Infinity : 10,
    maxCollections: isPremium ? Infinity : 3,
    maxSavedEvents: isPremium ? Infinity : 10
  }
}

export default {
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken,
  extractToken,
  getUserFromRequest,
  createAuthCookie,
  createLogoutCookie,
  isValidEmail,
  validatePassword,
  generateUsername,
  isPremiumUser,
  getUserLimits
}

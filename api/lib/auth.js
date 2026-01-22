/* global process */
/**
 * Authentication Utilities
 *
 * JWT token generation/verification and password hashing.
 */

import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { queryOne } from './db.js'

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-dev-secret-change-me'
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
    JWT_SECRET,
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
    return jwt.verify(token, JWT_SECRET)
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
  // Check Authorization header
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }

  // Check cookies
  const cookies = req.headers.get('cookie')
  if (cookies) {
    const tokenCookie = cookies
      .split(';')
      .find(c => c.trim().startsWith('roam_token='))
    if (tokenCookie) {
      return tokenCookie.split('=')[1]
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
    'SELECT id, email, username, display_name, avatar_url, email_verified, created_at FROM users WHERE id = ?',
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
  return `roam_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
}

/**
 * Create logout cookie (clears auth)
 * @returns {string} Cookie string that clears token
 */
export function createLogoutCookie() {
  return 'roam_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
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
  generateUsername
}

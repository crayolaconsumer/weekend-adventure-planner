/**
 * Cryptographic Utilities
 *
 * Secure random generation and related functions.
 */

import { randomBytes, timingSafeEqual } from 'crypto'

/**
 * Generate a cryptographically secure random string
 * @param {number} length - Desired length of the string
 * @param {string} charset - Characters to use (default: alphanumeric lowercase)
 * @returns {string} Random string
 */
export function generateSecureCode(length = 16, charset = 'abcdefghijklmnopqrstuvwxyz0123456789') {
  const charsetLength = charset.length
  const bytes = randomBytes(length)
  let result = ''

  for (let i = 0; i < length; i++) {
    result += charset[bytes[i] % charsetLength]
  }

  return result
}

/**
 * Generate a share code for plans
 * Uses 16 characters (36^16 ≈ 7.9 x 10^24 possibilities)
 * @returns {string} Share code
 */
export function generateShareCode() {
  return generateSecureCode(16, 'abcdefghijklmnopqrstuvwxyz0123456789')
}

/**
 * Generate a verification token
 * @returns {string} 32-character token
 */
export function generateVerificationToken() {
  return randomBytes(16).toString('hex')
}

/**
 * Generate a password reset token
 * @returns {string} 32-character token
 */
export function generatePasswordResetToken() {
  return randomBytes(16).toString('hex')
}

/**
 * Constant-time string comparison to prevent timing attacks
 * Uses Node.js crypto.timingSafeEqual for proper constant-time comparison
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if equal
 */
export function secureCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false
  }

  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)

  if (bufA.length !== bufB.length) {
    return false
  }

  return timingSafeEqual(bufA, bufB)
}

export default {
  generateSecureCode,
  generateShareCode,
  generateVerificationToken,
  generatePasswordResetToken,
  secureCompare
}

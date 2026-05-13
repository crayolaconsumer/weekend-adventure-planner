/**
 * Cryptographic Utilities
 *
 * Secure random generation and related functions.
 */

import { randomBytes, timingSafeEqual } from 'crypto'

/**
 * Generate a cryptographically secure random string
 */
export function generateSecureCode(
  length: number = 16,
  charset: string = 'abcdefghijklmnopqrstuvwxyz0123456789',
): string {
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
 */
export function generateShareCode(): string {
  return generateSecureCode(16, 'abcdefghijklmnopqrstuvwxyz0123456789')
}

/**
 * Generate a verification token (32-char hex)
 */
export function generateVerificationToken(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Generate a password reset token (32-char hex)
 */
export function generatePasswordResetToken(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
export function secureCompare(a: unknown, b: unknown): boolean {
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
  secureCompare,
}

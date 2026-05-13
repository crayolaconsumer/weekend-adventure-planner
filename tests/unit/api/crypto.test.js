import { describe, it, expect } from 'vitest'
import {
  generateSecureCode,
  generateShareCode,
  generateVerificationToken,
  generatePasswordResetToken,
  secureCompare,
} from '../../../api/lib/crypto.js'

describe('generateSecureCode', () => {
  it('returns a string of the requested length', () => {
    expect(generateSecureCode(8)).toHaveLength(8)
    expect(generateSecureCode(32)).toHaveLength(32)
  })

  it('only uses characters from the provided charset', () => {
    const charset = 'ABC123'
    const code = generateSecureCode(50, charset)
    for (const ch of code) {
      expect(charset).toContain(ch)
    }
  })

  it('produces different codes on each call (entropy check)', () => {
    const codes = new Set()
    for (let i = 0; i < 10; i++) codes.add(generateSecureCode(16))
    // 10 codes of 16 chars from 36-char alphabet should be unique with overwhelming probability
    expect(codes.size).toBe(10)
  })
})

describe('generateShareCode', () => {
  it('returns 16-char lowercase-alphanumeric string', () => {
    const code = generateShareCode()
    expect(code).toHaveLength(16)
    expect(code).toMatch(/^[a-z0-9]+$/)
  })
})

describe('generateVerificationToken / generatePasswordResetToken', () => {
  it('returns 32-char hex strings', () => {
    expect(generateVerificationToken()).toMatch(/^[a-f0-9]{32}$/)
    expect(generatePasswordResetToken()).toMatch(/^[a-f0-9]{32}$/)
  })

  it('produces different tokens each call', () => {
    expect(generateVerificationToken()).not.toBe(generateVerificationToken())
  })
})

describe('secureCompare', () => {
  it('returns true for matching strings', () => {
    expect(secureCompare('abcdef', 'abcdef')).toBe(true)
  })

  it('returns false for different strings of same length', () => {
    expect(secureCompare('abcdef', 'abcdez')).toBe(false)
  })

  it('returns false for different lengths', () => {
    expect(secureCompare('abc', 'abcd')).toBe(false)
  })

  it('returns false for non-string inputs', () => {
    expect(secureCompare(null, 'abc')).toBe(false)
    expect(secureCompare('abc', null)).toBe(false)
    expect(secureCompare(undefined, undefined)).toBe(false)
    expect(secureCompare(42, '42')).toBe(false)
  })
})

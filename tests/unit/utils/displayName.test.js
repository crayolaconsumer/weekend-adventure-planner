import { describe, it, expect } from 'vitest'
import { formatDisplayName, needsDisplayName } from '../../../src/utils/displayName.js'

describe('formatDisplayName', () => {
  it("returns 'Someone' for null/undefined/non-object", () => {
    expect(formatDisplayName(null)).toBe('Someone')
    expect(formatDisplayName(undefined)).toBe('Someone')
    expect(formatDisplayName('a string')).toBe('Someone')
    expect(formatDisplayName(42)).toBe('Someone')
  })

  it('prefers displayName (camelCase) when set and clean', () => {
    expect(formatDisplayName({ displayName: 'Alex', username: 'alex123' })).toBe('Alex')
  })

  it('prefers display_name (snake_case) when set and clean', () => {
    expect(formatDisplayName({ display_name: 'Alex', username: 'alex123' })).toBe('Alex')
  })

  it('falls back to username when displayName is email-shaped', () => {
    expect(formatDisplayName({ displayName: 'alex@example.com', username: 'alex123' })).toBe('alex123')
  })

  it('falls back to email prefix when both are email-shaped', () => {
    expect(formatDisplayName({ displayName: 'alex@example.com', username: 'alex@x.com' })).toBe('alex')
  })

  it("returns 'Someone' when nothing usable is set", () => {
    expect(formatDisplayName({})).toBe('Someone')
    expect(formatDisplayName({ displayName: '', username: '' })).toBe('Someone')
  })

  it('trims whitespace', () => {
    expect(formatDisplayName({ displayName: '  Alex  ' })).toBe('Alex')
  })
})

describe('needsDisplayName', () => {
  it('is false for null/non-object', () => {
    expect(needsDisplayName(null)).toBe(false)
    expect(needsDisplayName('foo')).toBe(false)
  })

  it('is true when displayName missing', () => {
    expect(needsDisplayName({})).toBe(true)
  })

  it('is true when displayName is email-shaped', () => {
    expect(needsDisplayName({ displayName: 'alex@example.com' })).toBe(true)
  })

  it('is true when displayName is whitespace-only', () => {
    expect(needsDisplayName({ displayName: '   ' })).toBe(true)
  })

  it('is false when displayName is a clean name', () => {
    expect(needsDisplayName({ displayName: 'Alex' })).toBe(false)
  })

  it('supports snake_case', () => {
    expect(needsDisplayName({ display_name: 'alex@example.com' })).toBe(true)
    expect(needsDisplayName({ display_name: 'Alex' })).toBe(false)
  })
})

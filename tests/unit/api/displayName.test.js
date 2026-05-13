import { describe, it, expect } from 'vitest'
import { formatDisplayName } from '../../../api/lib/displayName.js'

describe('api/lib/displayName.formatDisplayName', () => {
  it("returns 'Someone' fallback", () => {
    expect(formatDisplayName(null)).toBe('Someone')
    expect(formatDisplayName(undefined)).toBe('Someone')
    expect(formatDisplayName('string')).toBe('Someone')
  })

  it('prefers displayName when clean', () => {
    expect(formatDisplayName({ displayName: 'Alex', username: 'alex123' })).toBe('Alex')
  })

  it('prefers display_name (snake_case)', () => {
    expect(formatDisplayName({ display_name: 'Bea' })).toBe('Bea')
  })

  it('falls back to username when display is email-shaped', () => {
    expect(formatDisplayName({ displayName: 'a@b.com', username: 'alex' })).toBe('alex')
  })

  it('falls back to email prefix when both are emails', () => {
    expect(formatDisplayName({ displayName: 'alex@example.com', username: 'alex@x.com' })).toBe('alex')
  })

  it('trims whitespace', () => {
    expect(formatDisplayName({ displayName: '  Alex  ' })).toBe('Alex')
  })

  it('handles empty strings', () => {
    expect(formatDisplayName({ displayName: '', username: '' })).toBe('Someone')
  })

  // This is the contract for parity with src/utils/displayName.js so
  // OG-image / push / email surfaces never leak emails.
  it('client and server implementations agree on email leakage gate', async () => {
    const { formatDisplayName: clientFmt } = await import('../../../src/utils/displayName.js')
    const cases = [
      { displayName: 'Alex' },
      { displayName: 'a@b.com', username: 'alex' },
      {},
      null,
      { display_name: 'Bea' },
    ]
    for (const c of cases) {
      expect(formatDisplayName(c)).toBe(clientFmt(c))
    }
  })
})

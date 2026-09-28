import { describe, it, expect } from 'vitest'
import { classifyLoadError } from '../../../src/pages/Discover/ErrorRecovery'

describe('Discover/ErrorRecovery.classifyLoadError', () => {
  describe('offline vs upstream (the "Can\'t reach the internet" guard)', () => {
    it('blames the internet only when the device is actually offline', () => {
      const offline = classifyLoadError('Failed to fetch', { isOffline: true })
      expect(offline.kind).toBe('network')
      expect(offline.title).toBe("Can't reach the internet")
    })

    // Regression: the old classifier blamed the internet for ANY fetch
    // failure, even when the device was online (so an upstream/server fault
    // told the user to check their connection). Online, a fetch failure is
    // upstream, not the user's connection.
    it('does NOT blame the internet when the device is online (upstream)', () => {
      const online = classifyLoadError('Failed to fetch', { isOffline: false })
      expect(online.kind).toBe('upstream')
      expect(online.title).not.toBe("Can't reach the internet")
      expect(online.kind).not.toBe('network')
    })

    it('treats a missing isOffline as online (fail toward upstream, not blame)', () => {
      const def = classifyLoadError('Failed to fetch')
      expect(def.kind).toBe('upstream')
      expect(def.title).not.toBe("Can't reach the internet")
    })
  })

  describe('other error classes', () => {
    it('classifies timeout', () => {
      const c = classifyLoadError('Request timeout', { isOffline: false })
      expect(c.kind).toBe('timeout')
    })

    it('classifies rate limit', () => {
      const c = classifyLoadError('HTTP 429 Too Many Requests', { isOffline: false })
      expect(c.kind).toBe('rate_limit')
    })

    it('classifies server errors', () => {
      const c = classifyLoadError('HTTP 502 Bad Gateway', { isOffline: false })
      expect(c.kind).toBe('server')
    })

    it('falls back to generic for unknown errors', () => {
      const c = classifyLoadError('something weird happened', { isOffline: false })
      expect(c.kind).toBe('generic')
    })

    it('returns generic for null/empty', () => {
      expect(classifyLoadError(null, { isOffline: false }).kind).toBe('generic')
      expect(classifyLoadError('', { isOffline: false }).kind).toBe('generic')
    })
  })
})

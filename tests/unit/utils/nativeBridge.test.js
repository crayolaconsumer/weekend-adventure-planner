import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isNative,
  getPlatform,
  isIosNative,
  getApiBaseUrl,
  getPublicShareUrl,
  absoluteApiUrl,
} from '../../../src/utils/nativeBridge.js'

const API_ORIGIN = 'https://www.go-roam.uk'

describe('nativeBridge', () => {
  let originalCapacitor

  beforeEach(() => {
    originalCapacitor = window.Capacitor
  })

  afterEach(() => {
    if (originalCapacitor === undefined) delete window.Capacitor
    else window.Capacitor = originalCapacitor
  })

  describe('isNative', () => {
    it('is false when Capacitor is absent', () => {
      delete window.Capacitor
      expect(isNative()).toBe(false)
    })

    it('is false when Capacitor.isNativePlatform returns false', () => {
      window.Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web' }
      expect(isNative()).toBe(false)
    })

    it('is true when Capacitor.isNativePlatform returns true', () => {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' }
      expect(isNative()).toBe(true)
    })
  })

  describe('getPlatform', () => {
    it("returns 'web' when Capacitor is absent", () => {
      delete window.Capacitor
      expect(getPlatform()).toBe('web')
    })

    it("returns 'ios' for iOS native", () => {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' }
      expect(getPlatform()).toBe('ios')
    })

    it("returns 'android' for Android native", () => {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' }
      expect(getPlatform()).toBe('android')
    })
  })

  describe('isIosNative', () => {
    it('is true only when native AND iOS', () => {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' }
      expect(isIosNative()).toBe(true)
    })

    it('is false on Android native', () => {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' }
      expect(isIosNative()).toBe(false)
    })

    it('is false on web', () => {
      delete window.Capacitor
      expect(isIosNative()).toBe(false)
    })
  })

  describe('getApiBaseUrl', () => {
    it('returns empty string on web (same-origin)', () => {
      delete window.Capacitor
      expect(getApiBaseUrl()).toBe('')
    })

    it('returns API origin on native', () => {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' }
      expect(getApiBaseUrl()).toBe(API_ORIGIN)
    })
  })

  describe('getPublicShareUrl', () => {
    it('builds a canonical URL from a path with leading slash', () => {
      expect(getPublicShareUrl('/plan/share/abc')).toBe(`${API_ORIGIN}/plan/share/abc`)
    })

    it('adds a leading slash if missing', () => {
      expect(getPublicShareUrl('plan/share/abc')).toBe(`${API_ORIGIN}/plan/share/abc`)
    })

    it('handles empty path → bare origin', () => {
      expect(getPublicShareUrl('')).toBe(`${API_ORIGIN}/`)
    })

    it('ignores native/web platform — share URLs always canonical', () => {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' }
      expect(getPublicShareUrl('/place/123')).toBe(`${API_ORIGIN}/place/123`)
    })
  })

  describe('absoluteApiUrl', () => {
    it('rewrites /api/* to absolute on native', () => {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' }
      expect(absoluteApiUrl('/api/auth')).toBe(`${API_ORIGIN}/api/auth`)
    })

    it('returns /api/* unchanged on web (same-origin)', () => {
      delete window.Capacitor
      expect(absoluteApiUrl('/api/auth')).toBe('/api/auth')
    })

    it('returns non-/api/ paths unchanged', () => {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' }
      expect(absoluteApiUrl('/somewhere/else')).toBe('/somewhere/else')
    })

    it('handles falsy input safely', () => {
      expect(absoluteApiUrl(null)).toBe(null)
      expect(absoluteApiUrl(undefined)).toBe(undefined)
    })
  })
})

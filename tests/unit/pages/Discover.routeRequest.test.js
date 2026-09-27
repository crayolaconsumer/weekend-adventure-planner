import { describe, it, expect } from 'vitest'
import { routeRequest, routeResetKey } from '../../../src/pages/Discover/routeRequest.js'

// App.jsx sets this when location is denied
const LONDON_FALLBACK = { lat: 51.5074, lng: -0.1278, isFallback: true }
const FIX = { lat: 53.96, lng: -1.08, fromDeviceFix: true }
const place = { id: 'p', name: 'Minster', lat: 53.962, lng: -1.082 }

describe('Discover map route request', () => {
  it('never routes from the London fallback: no origin, so the device is asked', () => {
    expect(routeRequest('walking', LONDON_FALLBACK, place)).toEqual({ from: null, to: place, mode: 'walk' })
  })

  it('routes from a genuine device fix', () => {
    expect(routeRequest('transit', FIX, place).from).toBe(FIX)
  })

  it('maps travel modes (driving-range modes drive)', () => {
    expect(['walking', 'transit', 'driving', 'dayTrip', 'explorer'].map(m => routeRequest(m, FIX, place).mode))
      .toEqual(['walk', 'transit', 'drive', 'drive', 'drive'])
  })

  it('keeps fallback coords out of the reset key', () => {
    expect(routeResetKey('walking', LONDON_FALLBACK)).toBe('walking|none')
    expect(routeResetKey('walking', null)).toBe('walking|none')
    expect(routeResetKey('walking', FIX)).toBe('walking|53.96,-1.08')
  })
})

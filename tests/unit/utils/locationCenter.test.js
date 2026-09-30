import { describe, it, expect } from 'vitest'
import { nextFetchCenter, shouldApplyFix } from '../../../src/utils/locationCenter'

// Harpenden centre, with points offset north by a known amount.
// 1 deg of latitude ≈ 111 km, so:
//   0.0009 deg ≈ 100 m (a small move, below the 500 m re-center threshold)
//   0.0054 deg ≈ 600 m (a large move, above the threshold)
const HARPENDEN = { lat: 51.6234, lng: -0.6284 }
const CLOSE = { lat: 51.6243, lng: -0.6284 }
const FAR = { lat: 51.6288, lng: -0.6284 }

const THRESHOLD_M = 500

describe('nextFetchCenter', () => {
  it('returns the first fix when there is no previous center', () => {
    expect(nextFetchCenter(null, HARPENDEN, THRESHOLD_M)).toBe(HARPENDEN)
  })

  it('keeps the previous center for a small move (below threshold)', () => {
    // Walking 100 m must NOT re-center — the deck stays, distances update.
    expect(nextFetchCenter(HARPENDEN, CLOSE, THRESHOLD_M)).toBe(HARPENDEN)
  })

  it('re-centers for a large move (at/above threshold)', () => {
    // Moving 600 m IS a re-center — the deck re-fetches around the new spot.
    expect(nextFetchCenter(HARPENDEN, FAR, THRESHOLD_M)).toBe(FAR)
  })

  it('returns prev when next is null', () => {
    expect(nextFetchCenter(HARPENDEN, null, THRESHOLD_M)).toBe(HARPENDEN)
  })
})

describe('shouldApplyFix', () => {
  const PREV = { lat: 51.6, lng: -0.6 }
  const THRESHOLD_M = 100

  it('returns false when there is no previous fix', () => {
    expect(shouldApplyFix(null, { latitude: 51.6, longitude: -0.6 }, THRESHOLD_M)).toBe(false)
  })

  it('returns false (no crash) when the plugin delivers a null/error position', () => {
    // The geolocation plugin sends watch errors to the position callback as
    // (null, err). The guard must handle null without throwing.
    expect(shouldApplyFix(PREV, null, THRESHOLD_M)).toBe(false)
    expect(shouldApplyFix(PREV, undefined, THRESHOLD_M)).toBe(false)
  })

  it('returns false for a sub-threshold move (GPS jitter)', () => {
    // ~11 m north — below the 100 m threshold, so it must not churn the UI.
    expect(shouldApplyFix(PREV, { latitude: 51.6001, longitude: -0.6 }, THRESHOLD_M)).toBe(false)
  })

  it('returns true for a move at/above the threshold', () => {
    // ~220 m north — a real move, so the live location updates.
    expect(shouldApplyFix(PREV, { latitude: 51.602, longitude: -0.6 }, THRESHOLD_M)).toBe(true)
  })
})

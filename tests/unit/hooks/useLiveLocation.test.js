import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useLiveLocation } from '../../../src/hooks/useLiveLocation'

// The plugin facade is mocked so we can drive fixes (and errors) exactly the
// way the native/web geolocation stack delivers them.
const { mockGetCurrentPosition, mockWatchPosition } = vi.hoisted(() => ({
  mockGetCurrentPosition: vi.fn(),
  mockWatchPosition: vi.fn(),
}))

vi.mock('../../../src/utils/nativePlugins', () => ({
  getCurrentPosition: (...args) => mockGetCurrentPosition(...args),
  watchPosition: (...args) => mockWatchPosition(...args),
}))

// Captures the position callback the hook hands to watchPosition, so a test
// can deliver fixes / errors the way the plugin would.
let capturedOnPosition = null

beforeEach(() => {
  vi.clearAllMocks()
  capturedOnPosition = null
  mockWatchPosition.mockImplementation((_options, onPosition) => {
    capturedOnPosition = onPosition
    return vi.fn() // the stop function
  })
})

afterEach(() => { vi.restoreAllMocks() })

describe('useLiveLocation', () => {
  it('takes a fix and starts the watch on mount (so distances track movement)', async () => {
    mockGetCurrentPosition.mockResolvedValue({ coords: { latitude: 51.6, longitude: -0.6 } })
    const { result } = renderHook(() => useLiveLocation({ enabled: true }))
    await waitFor(() => expect(result.current.location).toEqual({ lat: 51.6, lng: -0.6, fromDeviceFix: true }))
    expect(mockWatchPosition).toHaveBeenCalledTimes(1)
  })

  it('re-starts the watch on retry (so distances recover after a launch-time failure)', async () => {
    mockGetCurrentPosition.mockResolvedValue({ coords: { latitude: 51.6, longitude: -0.6 } })
    const { result } = renderHook(() => useLiveLocation({ enabled: true }))
    await waitFor(() => expect(mockWatchPosition).toHaveBeenCalledTimes(1))

    act(() => { result.current.retryLocation() })
    // The regression: the old retry took one fix and left the watch dead.
    await waitFor(() => expect(mockWatchPosition).toHaveBeenCalledTimes(2))
  })

  it('does not crash on a null position (watch error) and ignores sub-threshold jitter', async () => {
    mockGetCurrentPosition.mockResolvedValue({ coords: { latitude: 51.6, longitude: -0.6 } })
    const { result } = renderHook(() => useLiveLocation({ enabled: true }))
    await waitFor(() => expect(result.current.location).toEqual({ lat: 51.6, lng: -0.6, fromDeviceFix: true }))

    // A watch error arrives as (null, err) — must not throw; location unchanged.
    act(() => { expect(() => capturedOnPosition(null, new Error('timeout'))).not.toThrow() })
    expect(result.current.location).toEqual({ lat: 51.6, lng: -0.6, fromDeviceFix: true })

    // Sub-threshold jitter (~11 m) is ignored.
    act(() => { capturedOnPosition({ coords: { latitude: 51.6001, longitude: -0.6 } }) })
    expect(result.current.location).toEqual({ lat: 51.6, lng: -0.6, fromDeviceFix: true })

    // A real move (~220 m) is applied.
    act(() => { capturedOnPosition({ coords: { latitude: 51.602, longitude: -0.6 } }) })
    expect(result.current.location).toEqual({ lat: 51.602, lng: -0.6, fromDeviceFix: true })
  })

  it('does not start the watch while disabled (onboarding / partner portal)', () => {
    mockGetCurrentPosition.mockResolvedValue({ coords: { latitude: 51.6, longitude: -0.6 } })
    renderHook(() => useLiveLocation({ enabled: false }))
    expect(mockGetCurrentPosition).not.toHaveBeenCalled()
    expect(mockWatchPosition).not.toHaveBeenCalled()
  })

  it('clears locationError once a fix succeeds (so the recovery banner goes away)', async () => {
    // First attempt fails -> London fallback + error banner.
    mockGetCurrentPosition.mockRejectedValueOnce(new Error('permission denied'))
    const { result } = renderHook(() => useLiveLocation({ enabled: true }))
    await waitFor(() => expect(result.current.locationError).toBeTruthy())
    expect(result.current.location.isFallback).toBe(true)

    // Retry succeeds -> error cleared and a real fix lands.
    mockGetCurrentPosition.mockResolvedValueOnce({ coords: { latitude: 51.6, longitude: -0.6 } })
    act(() => { result.current.retryLocation() })
    await waitFor(() => expect(result.current.locationError).toBe(null))
    expect(result.current.location).toEqual({ lat: 51.6, lng: -0.6, fromDeviceFix: true })
  })
})

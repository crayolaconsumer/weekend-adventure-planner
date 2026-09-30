import { useState, useRef, useEffect, useCallback } from 'react'
import { getCurrentPosition as nativeGetCurrentPosition, watchPosition } from '../utils/nativePlugins'
import { shouldApplyFix } from '../utils/locationCenter'

// A live fix is only applied once we've moved this far, so GPS jitter doesn't
// churn the UI.
const LOCATION_MOVE_THRESHOLD_M = 100
// Display-only fallback when geolocation is unavailable. NOT a real fix —
// it must never be persisted for "events near you" (see fromDeviceFix).
const LONDON_FALLBACK = { lat: 51.5074, lng: -0.1278, isFallback: true }

/**
 * Continuous device location.
 *
 * Takes ONE fix for the initial load, then KEEPS WATCHING so the live
 * position — and therefore every displayed distance — tracks the user as
 * they move. A one-shot fix made "x metres away" go stale on a walk.
 *
 * The watch only applies a fix once we've moved a meaningful distance
 * (LOCATION_MOVE_THRESHOLD_M). `retry()` re-runs the whole lifecycle (a fresh
 * fix AND a re-started watch), which is what makes distances recover after a
 * launch-time location failure — the old code took one fix on retry and left
 * the watch dead.
 *
 * Returns `{ location, locationError, retryLocation }`.
 */
export function useLiveLocation({ enabled }) {
  const [location, setLocation] = useState(null)
  const [locationError, setLocationError] = useState(null)
  // Bumped by retry() to re-run the effect below (the single owner of the
  // position watch).
  const [retryNonce, setRetryNonce] = useState(0)
  // Live mirror of `location` for the watch callback, which would otherwise
  // capture a stale value in its closure.
  const locationRef = useRef(null)
  useEffect(() => { locationRef.current = location }, [location])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let stopWatch = null

    const start = async () => {
      // Route via the native plugin on Capacitor — Android REQUIRES the
      // plugin to trigger the runtime permission dialog (the web
      // navigator.geolocation path in Capacitor's WebView won't ask for
      // ACCESS_FINE_LOCATION). On iOS native, the plugin also gives
      // better accuracy and uses the entitlement string we set in
      // Info.plist (NSLocationWhenInUseUsageDescription). On web,
      // nativeGetCurrentPosition falls through to navigator.geolocation.
      const position = await nativeGetCurrentPosition({ enableHighAccuracy: true, timeout: 10000 })
      if (cancelled) return
      // fromDeviceFix marks a GENUINE device fix — only these are persisted
      // for "events near you" (the London fallback below must never be).
      setLocation({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        fromDeviceFix: true
      })
      // Clear any prior error so the recovery banner goes away once a genuine
      // fix lands (e.g. after the user taps "Enable location" and retries).
      setLocationError(null)
      // Keep watching so the live location — and therefore every displayed
      // distance — tracks the user as they move.
      stopWatch = await watchPosition(
        { enableHighAccuracy: true, timeout: 10000 },
        (pos) => {
          const next = pos && pos.coords
          if (!shouldApplyFix(locationRef.current, next, LOCATION_MOVE_THRESHOLD_M)) return
          setLocation({
            lat: next.latitude,
            lng: next.longitude,
            fromDeviceFix: true
          })
        },
        () => { /* watch errors are non-fatal; the last good fix stands */ }
      )
      if (cancelled) stopWatch()
    }

    start().catch((error) => {
      if (cancelled) return
      setLocationError(error?.message || 'Geolocation failed')
      // Default to London as fallback (display only — not a real fix).
      setLocation(LONDON_FALLBACK)
    })

    return () => {
      cancelled = true
      if (stopWatch) stopWatch()
    }
  }, [enabled, retryNonce])

  const retryLocation = useCallback(() => setRetryNonce((n) => n + 1), [])

  return { location, locationError, retryLocation }
}

import { useState, useEffect, useCallback } from 'react'
import { getCurrentPosition as nativeGetCurrentPosition, watchPosition } from '../utils/nativePlugins'
import { nextFetchCenter } from '../utils/locationCenter'

// Smaller moves are GPS jitter and don't churn the UI
const LOCATION_MOVE_THRESHOLD_M = 100
// Display only: never persisted for "events near you" (no fromDeviceFix)
const LONDON_FALLBACK = { lat: 51.5074, lng: -0.1278, isFallback: true }
const GPS = { enableHighAccuracy: true, timeout: 10000 }

/**
 * One fix, then a live watch so distances track the user on a walk.
 * retryLocation() re-runs both (a fresh fix and a restarted watch).
 */
export function useLiveLocation({ enabled }) {
  const [location, setLocation] = useState(null)
  const [locationError, setLocationError] = useState(null)
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let stopWatch = null

    const start = async () => {
      // The native plugin: Android only asks for the permission through it
      const position = await nativeGetCurrentPosition(GPS)
      if (cancelled) return
      setLocation({ lat: position.coords.latitude, lng: position.coords.longitude, fromDeviceFix: true })
      setLocationError(null)
      stopWatch = await watchPosition(
        GPS,
        (pos) => {
          const c = pos?.coords // the plugin sends watch errors here as (null, err)
          if (!c) return
          const fix = { lat: c.latitude, lng: c.longitude, fromDeviceFix: true }
          setLocation(prev => (prev && nextFetchCenter(prev, fix, LOCATION_MOVE_THRESHOLD_M) === fix ? fix : prev))
        },
        () => {} // non-fatal: the last good fix stands
      )
      if (cancelled) stopWatch()
    }

    start().catch((error) => {
      if (cancelled) return
      setLocationError(error?.message || 'Geolocation failed')
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

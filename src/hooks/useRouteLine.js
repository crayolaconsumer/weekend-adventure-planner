/**
 * useRouteLine: fetch a drawable route from the user's location to a place.
 *
 * `from` must be a real device location, never a default/fallback one; pass
 * null and the device position is asked for on tap. A request counter drops
 * stale responses, so tapping a second place (or clearing) mid-flight wins.
 *
 * `resetKey`: when it changes (travel mode, origin, place) the
 * route is cleared and any in-flight response for the old key is dropped.
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { getRouteLine } from '../utils/routingService'
import { isNative } from '../utils/nativeBridge'

// Safari can leave a permission prompt unanswered with no timeout firing
const POSITION_TIMEOUT_MS = 12000

// Web GeolocationPositionError PERMISSION_DENIED is code 1. Capacitor
// Geolocation (iOS + Android): 0003 permission denied, 0007 location services
// off, 0008 restricted, 0009 enable request refused.
const NATIVE_DENIED = new Set(['OS-PLUG-GLOC-0003', 'OS-PLUG-GLOC-0007', 'OS-PLUG-GLOC-0008', 'OS-PLUG-GLOC-0009'])
export function isLocationDenied(err) {
  return err?.code === 1 || NATIVE_DENIED.has(err?.code)
}

/** A location usable as a route origin: a genuine device fix, never the London fallback. */
export function realOrigin(loc) {
  return loc?.fromDeviceFix && !loc.isFallback && loc.lat != null && loc.lng != null ? loc : null
}

export function useRouteLine(resetKey = '') {
  const [route, setRoute] = useState(null)
  const requestRef = useRef(0)
  const keyRef = useRef(resetKey)
  const [prevKey, setPrevKey] = useState(resetKey)
  if (resetKey !== prevKey) {
    setPrevKey(resetKey)
    setRoute(null)
  }
  useEffect(() => { keyRef.current = resetKey }, [resetKey])

  const request = useCallback(async ({ from, to, mode = 'walk' }) => {
    const id = ++requestRef.current
    const key = keyRef.current
    const current = () => id === requestRef.current && key === keyRef.current
    setRoute({ status: 'loading', to, mode })

    let origin = from
    if (!origin) {
      try {
        const { getCurrentPosition } = await import('../utils/nativePlugins')
        let timer
        const pos = await Promise.race([
          getCurrentPosition(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), POSITION_TIMEOUT_MS) })
        ]).finally(() => clearTimeout(timer))
        origin = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      } catch (err) {
        if (!current()) return
        setRoute(isLocationDenied(err)
          ? { status: 'error', to, mode, canOpenSettings: isNative(), message: 'Turn on location to see a route from where you are.' }
          : { status: 'error', to, mode, canRetry: true, message: "Couldn't get your location. Try again." })
        return
      }
    }

    const result = await getRouteLine({ lat: origin.lat, lng: origin.lng }, { lat: to.lat, lng: to.lng }, mode)
    if (!current()) return
    setRoute({ status: 'ready', to, mode, from: origin, ...result })
  }, [])

  const clear = useCallback(() => {
    requestRef.current++
    setRoute(null)
  }, [])

  return { route, request, clear }
}

/** The route, or null when its destination is no longer among `places`. */
export function routeForPlaces(route, places) {
  if (!route?.to || route.to.id == null) return route
  return places.some(p => p.id === route.to.id) ? route : null
}

export default useRouteLine

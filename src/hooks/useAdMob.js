import { useEffect, useCallback, useRef } from 'react'
import { useSubscription } from './useSubscription'
import { useAuth } from '../contexts/AuthContext'
import { isNative } from '../utils/nativeBridge'
import {
  initAdMobIfNeeded,
  showBanner,
  hideBanner,
  maybeShowInterstitial,
  resetAdMobState,
} from '../utils/adMob'

/**
 * Hook for managing AdMob lifecycle on a screen.
 *
 * Usage on Discover (or any screen that should show a banner):
 *   const { trackSwipe } = useAdMob({ bannerOnScreen: true })
 *   // pass trackSwipe to CardStack onSwipe so it fires on every action
 *
 * Behaviour:
 *   - Initializes AdMob once per session on native, after auth resolves
 *     and the user is confirmed non-premium.
 *   - Toggles the banner overlay based on bannerOnScreen.
 *   - Returns trackSwipe() which the deck calls; we frequency-cap
 *     interstitials internally.
 *   - When the user upgrades to premium mid-session, immediately hides
 *     the banner and resets all counters.
 */
export function useAdMob({ bannerOnScreen = false } = {}) {
  const { user, loading: authLoading } = useAuth()
  const { isPremium } = useSubscription()
  const initRef = useRef(false)

  // One-time init when we know the user is non-premium and we're on native.
  // Re-runs if user state shifts (login/logout/upgrade) but the underlying
  // initAdMobIfNeeded is idempotent.
  useEffect(() => {
    if (authLoading) return
    if (!isNative()) return
    if (isPremium) {
      resetAdMobState()
      return
    }
    if (initRef.current) return

    initRef.current = true
    initAdMobIfNeeded({ isPremium: false }).catch(err => {
      console.warn('[useAdMob] init failed', err)
    })
  }, [authLoading, isPremium, user?.id])

  // Banner lifecycle — bound to the screen the hook is mounted on.
  useEffect(() => {
    if (!isNative()) return
    if (isPremium) return
    if (!bannerOnScreen) return

    let cancelled = false
    showBanner().catch(err => {
      if (!cancelled) console.warn('[useAdMob] showBanner failed', err)
    })

    return () => {
      cancelled = true
      hideBanner().catch(() => {})
    }
  }, [bannerOnScreen, isPremium])

  const trackSwipe = useCallback(() => {
    if (isPremium) return
    maybeShowInterstitial({ isPremium }).catch(err => {
      console.warn('[useAdMob] interstitial failed', err)
    })
  }, [isPremium])

  return { trackSwipe, isPremium }
}

export default useAdMob

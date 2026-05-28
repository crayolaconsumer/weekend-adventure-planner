import { useEffect, useRef } from 'react'
import { isNative } from '../utils/nativeBridge'
import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../hooks/useSubscription'
import { isAdSenseConfigured, getAdSenseClientId, ADSENSE_SLOT_BANNER, injectAdSenseScript, pushAdSlot } from '../utils/adSense'
import './AdBanner.css'

/**
 * Cross-platform ad banner.
 *
 *   - On native iOS/Android: renders NOTHING. The native AdMob banner
 *     overlay is mounted/hidden by useAdMob() based on screen lifecycle.
 *     This component is only here to reserve layout space on web so the
 *     screen doesn't shift when the AdSense unit lazy-loads.
 *
 *   - On web with AdSense configured: renders the <ins> slot. AdSense
 *     fills it.
 *
 *   - On web without AdSense configured (i.e. before Google approves):
 *     renders a hidden placeholder of zero size. No visible UI.
 *
 *   - Hidden completely for premium users.
 */
export default function AdBanner({ slot = 'banner', className = '' }) {
  const { loading: authLoading } = useAuth()
  const { isPremium } = useSubscription()
  const insRef = useRef(null)
  const pushedRef = useRef(false)

  const onNative = isNative()
  const adSenseReady = !onNative && isAdSenseConfigured()
  const clientId = getAdSenseClientId()
  const slotId = slot === 'banner' ? ADSENSE_SLOT_BANNER : null

  useEffect(() => {
    // Block AdSense injection until auth resolves. On a cold load,
    // useAuth starts with user=null which makes useSubscription
    // momentarily report isPremium=false even for ROAM+ subscribers
    // — without this gate, we'd inject the AdSense pixel and fire an
    // ad request in that window, breaking the "no ads ever" promise.
    if (authLoading) return
    if (!adSenseReady) return
    if (isPremium) return
    injectAdSenseScript()
  }, [authLoading, adSenseReady, isPremium])

  useEffect(() => {
    if (authLoading) return
    if (!adSenseReady) return
    if (isPremium) return
    if (pushedRef.current) return
    if (!insRef.current) return
    pushAdSlot()
    pushedRef.current = true
  }, [authLoading, adSenseReady, isPremium])

  if (authLoading) return null
  if (isPremium) return null
  if (onNative) return null
  if (!adSenseReady || !clientId || !slotId) {
    // Reserve space so AdSense-not-yet-approved layout matches the
    // approved layout when it eventually arrives.
    return <div className={`ad-banner ad-banner-placeholder ${className}`} aria-hidden="true" />
  }

  return (
    <div className={`ad-banner ${className}`}>
      <span className="ad-banner-label">Ad</span>
      <ins
        ref={insRef}
        className="adsbygoogle ad-banner-slot"
        style={{ display: 'block' }}
        data-ad-client={clientId}
        data-ad-slot={slotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  )
}

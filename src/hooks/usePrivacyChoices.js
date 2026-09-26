import { useEffect, useState } from 'react'
import { isNative } from '../utils/nativeBridge'
import { isPrivacyOptionsRequired, showPrivacyOptions } from '../utils/adMob'
import { useSubscription } from './useSubscription'

// Web: AdSense's Privacy & messaging (Funding Choices) GDPR message is
// served by the adsbygoogle script and exposes window.googlefc. Its
// revocation message lets the user change consent. Queued per Google's
// docs so it runs once googlefc has finished loading.
function openWebChoices() {
  const fc = window.googlefc
  if (!fc) return
  fc.callbackQueue = fc.callbackQueue || []
  fc.callbackQueue.push(() => window.googlefc.showRevocationMessage())
}

/**
 * Consent entry point users must be able to reach wherever we show ads:
 * Google UMP privacy options on native, the AdSense consent message on web.
 * { required, open } on every platform so callers don't branch. Ad-free
 * users are never asked (no consent lookup at all).
 */
export function usePrivacyChoices() {
  const { noAds } = useSubscription()
  const native = isNative()
  const [nativeState, setNativeState] = useState(false)

  useEffect(() => {
    if (!native || noAds) return
    // Cheap: reads the consent result adMob.ts stores (one UMP lookup per
    // session there), so a later success is picked up on the next mount
    let live = true
    isPrivacyOptionsRequired().catch(() => false).then(r => { if (live) setNativeState(r) })
    return () => { live = false }
  }, [native, noAds])

  if (noAds) return { required: false, open: () => {} }
  if (native) return { required: nativeState, open: () => showPrivacyOptions().catch(() => {}) }
  return { required: typeof window !== 'undefined' && Boolean(window.googlefc), open: openWebChoices }
}

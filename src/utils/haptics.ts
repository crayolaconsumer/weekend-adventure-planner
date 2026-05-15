/**
 * Haptics utility — gentle vibration cues for key interactions.
 *
 * Native (iOS + Android): uses @capacitor/haptics. On iOS this hits
 * the Taptic Engine for the proper crisp click feel; on Android it
 * routes through the system vibrator with intensity tuned per
 * call style.
 *
 * Web / PWA: falls back to navigator.vibrate when available. Most
 * desktop browsers ignore the call (good — no feedback expected
 * with a mouse). Mobile Chrome on Android honours it.
 *
 * Imports are dynamic so the @capacitor/haptics module is only
 * loaded on native — Vite tree-shakes it out of the web bundle when
 * isNative() resolves to false at build time.
 *
 * Usage is fire-and-forget — all functions return Promise<void>
 * which can be awaited but rarely needs to be. Errors are
 * swallowed silently (a missed vibration is never worth crashing
 * the action that triggered it).
 */

import { isNative } from './nativeBridge'

type ImpactStyle = 'light' | 'medium' | 'heavy'

let cachedHaptics: typeof import('@capacitor/haptics') | null = null

async function getHaptics() {
  if (!isNative()) return null
  if (cachedHaptics) return cachedHaptics
  try {
    cachedHaptics = await import('@capacitor/haptics')
    return cachedHaptics
  } catch {
    return null
  }
}

/**
 * Tactile cue for a momentary action — button press, swipe-card
 * action chosen, save toggled. Maps to:
 *   - iOS UIImpactFeedbackGenerator (Light/Medium/Heavy)
 *   - Android VibrationEffect (calibrated short pulse)
 *   - Web navigator.vibrate (15–30ms)
 */
export async function tap(style: ImpactStyle = 'light'): Promise<void> {
  const h = await getHaptics()
  if (h) {
    try {
      const styleEnum =
        style === 'heavy' ? h.ImpactStyle.Heavy :
        style === 'medium' ? h.ImpactStyle.Medium :
        h.ImpactStyle.Light
      await h.Haptics.impact({ style: styleEnum })
      return
    } catch { /* fall through to web */ }
  }
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(style === 'heavy' ? 25 : style === 'medium' ? 18 : 12)
    } catch { /* permission denied — ignore */ }
  }
}

/**
 * UI selection cue — sub-tap, used when scrolling through a picker
 * or toggling a chip. Even subtler than tap('light').
 */
export async function selectionTick(): Promise<void> {
  const h = await getHaptics()
  if (h) {
    try {
      await h.Haptics.selectionStart()
      await h.Haptics.selectionChanged()
      await h.Haptics.selectionEnd()
      return
    } catch { /* fall through */ }
  }
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate(8) } catch { /* noop */ }
  }
}

/**
 * Success cue — used after a save, an upvote, marking a place
 * visited, etc. Slightly longer + double-tap rhythm.
 */
export async function success(): Promise<void> {
  const h = await getHaptics()
  if (h) {
    try {
      await h.Haptics.notification({ type: h.NotificationType.Success })
      return
    } catch { /* fall through */ }
  }
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate([15, 30, 15]) } catch { /* noop */ }
  }
}

/**
 * Warning / undo cue — paired with a destructive action (skip a
 * place, remove from saved). Single short buzz.
 */
export async function warn(): Promise<void> {
  const h = await getHaptics()
  if (h) {
    try {
      await h.Haptics.notification({ type: h.NotificationType.Warning })
      return
    } catch { /* fall through */ }
  }
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate(20) } catch { /* noop */ }
  }
}

export default { tap, selectionTick, success, warn }

/**
 * Native plugin facade — wraps Capacitor plugins so call-sites can stay
 * platform-agnostic. Each function:
 *   - On native: dynamically imports the plugin and uses it
 *   - On web: falls back to the equivalent browser API
 *
 * Dynamic imports keep the web bundle lean — Vite tree-shakes
 * @capacitor/* deps when isNative() is statically false.
 */

import { isNative, getPlatform } from './nativeBridge'

// ─── Sign in with Apple (native iOS) ─────────────────────────────
// On web, AuthModal uses Apple's JS SDK directly. On native iOS,
// Capacitor's plugin returns the same identityToken format that
// the server already validates. Audience differs (Bundle ID instead
// of Services ID) but our jwtVerify accepts both.

export async function nativeAppleSignIn() {
  if (!isNative() || getPlatform() !== 'ios') {
    throw new Error('Native Apple Sign In only available on iOS')
  }
  const { SignInWithApple } = await import('@capacitor-community/apple-sign-in')
  // crypto.randomUUID requires iOS 15.4+ in WKWebView — fall back to a
  // random hex string on iOS 14 so the call doesn't throw "is not a function".
  const nonce = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
  // The clientId must be the App Bundle ID for the native flow (not the Services ID)
  const result = await SignInWithApple.authorize({
    clientId: 'com.goroam.app',
    redirectURI: 'https://www.go-roam.uk/api/auth/apple/callback',
    scopes: 'email name',
    state: 'capacitor-native',
    nonce
  })
  // Plugin returns flat { identityToken, authorizationCode, user, email,
  // givenName, familyName }. Map to the shape the server expects.
  const r = result.response
  return {
    identityToken: r.identityToken,
    userInfo: {
      email: r.email || null,
      name: (r.givenName || r.familyName)
        ? { firstName: r.givenName || '', lastName: r.familyName || '' }
        : null
    }
  }
}

// ─── Share (native share sheet) ──────────────────────────────────

export async function shareContent({ title, text, url, dialogTitle }) {
  if (isNative()) {
    const { Share } = await import('@capacitor/share')
    return Share.share({ title, text, url, dialogTitle: dialogTitle || title })
  }
  // Web: navigator.share if available, otherwise caller falls back to
  // copy-to-clipboard via the existing web logic
  if (typeof navigator !== 'undefined' && navigator.share) {
    return navigator.share({ title, text, url })
  }
  throw new Error('Share not supported in this browser')
}

// ─── Browser (in-app browser for external links) ─────────────────

export async function openExternalUrl(url, options = {}) {
  if (isNative()) {
    const { Browser } = await import('@capacitor/browser')
    return Browser.open({
      url,
      windowName: '_blank',
      presentationStyle: options.presentationStyle || 'popover'
    })
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

// ─── Geolocation (native API on native) ──────────────────────────
// Native plugin handles iOS permission prompt (which uses the
// NSLocationWhenInUseUsageDescription string from Info.plist) and
// returns better accuracy + lower battery use than the web shim.

export async function getCurrentPosition(options = { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }) {
  if (isNative()) {
    const { Geolocation } = await import('@capacitor/geolocation')
    // Native plugin auto-requests permission if needed
    const pos = await Geolocation.getCurrentPosition(options)
    return {
      coords: {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        altitude: pos.coords.altitude,
        heading: pos.coords.heading,
        speed: pos.coords.speed
      },
      timestamp: pos.timestamp
    }
  }
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation not supported'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, options)
  })
}

export async function geolocationPermissionState() {
  if (isNative()) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation')
      const status = await Geolocation.checkPermissions()
      return status.location // 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'
    } catch {
      return 'prompt'
    }
  }
  if (typeof navigator !== 'undefined' && navigator.permissions) {
    try {
      const result = await navigator.permissions.query({ name: 'geolocation' })
      return result.state
    } catch {
      return 'prompt'
    }
  }
  return 'prompt'
}

// ─── Preferences (secure key-value store on native) ──────────────
// On native, replaces localStorage for sensitive values (auth token).
// On web, falls through to localStorage so the same API works
// universally. Prefer this for new code that stores anything we
// don't want lost on iOS "Clear Website Data" or surviving app
// uninstall (note: Capacitor Preferences IS cleared on uninstall).

export async function setPreference(key, value) {
  if (isNative()) {
    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.set({ key, value: typeof value === 'string' ? value : JSON.stringify(value) })
    return
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
  }
}

export async function getPreference(key) {
  if (isNative()) {
    const { Preferences } = await import('@capacitor/preferences')
    const { value } = await Preferences.get({ key })
    return value
  }
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(key)
  }
  return null
}

export async function removePreference(key) {
  if (isNative()) {
    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.remove({ key })
    return
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(key)
  }
}

// ─── Splash screen + status bar ──────────────────────────────────
// Hide splash after React has mounted enough to render initial screen.
// Status bar style follows our brand: dark forest green bg, light text.

export async function hideSplashScreen() {
  if (!isNative()) return
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide()
  } catch {
    /* plugin missing or simulator quirk — ignore */
  }
}

export async function configureStatusBar() {
  if (!isNative()) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: Style.Light })
    if (getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#1a3a2f' })
    }
  } catch {
    /* ignore */
  }
}

// ─── Keyboard (smooth show/hide on iOS) ──────────────────────────
// iOS WKWebView sometimes pushes content above the keyboard awkwardly.
// The Keyboard plugin lets us configure resize behaviour.

export async function configureKeyboard() {
  if (!isNative()) return
  try {
    const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard')
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body })
    await Keyboard.setScroll({ isDisabled: false })
  } catch {
    /* Android handles via android:windowSoftInputMode */
  }
}

export default {
  nativeAppleSignIn,
  shareContent,
  openExternalUrl,
  getCurrentPosition,
  geolocationPermissionState,
  setPreference,
  getPreference,
  removePreference,
  hideSplashScreen,
  configureStatusBar,
  configureKeyboard,
}

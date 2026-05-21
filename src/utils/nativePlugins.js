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
  const clientId = import.meta.env.VITE_APPLE_BUNDLE_ID || 'com.goroam.app'
  const redirectURI = import.meta.env.VITE_APPLE_REDIRECT_URI || 'https://www.go-roam.uk/api/auth/apple/callback'
  const result = await SignInWithApple.authorize({
    clientId,
    redirectURI,
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

// ─── Sign in with Google (native iOS + Android) ──────────────────
// Web flow uses Google Identity Services directly in AuthModal.
// Native uses @capgo/capacitor-social-login because Google blocks its
// JS SDK inside WKWebView and Android WebView (UA fingerprinting).
//
// Returns an idToken that the server's /api/auth { action: 'google',
// credential: idToken } path already accepts and verifies via
// google-auth-library's verifyIdToken (audience = our web client ID,
// which is iOSServerClientId in the plugin config — that's how the
// token's audience matches even when issued for the iOS client).

let socialLoginInitialized = false

async function ensureSocialLoginInitialized() {
  if (socialLoginInitialized) return
  const { SocialLogin } = await import('@capgo/capacitor-social-login')
  const webClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const iosClientId = import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID
  if (!webClientId || !iosClientId) {
    throw new Error('Google client IDs not configured (VITE_GOOGLE_CLIENT_ID + VITE_GOOGLE_IOS_CLIENT_ID)')
  }
  await SocialLogin.initialize({
    google: {
      webClientId,
      iOSClientId: iosClientId,
      // iOSServerClientId MUST equal the web client ID so the idToken's
      // audience claim matches what our server verifies against. Without
      // this, jwtVerify on the server rejects with "Wrong recipient".
      iOSServerClientId: webClientId,
      mode: 'online'
    }
  })
  socialLoginInitialized = true
}

export async function nativeGoogleSignIn() {
  if (!isNative()) {
    throw new Error('Native Google Sign In only available on native shells')
  }
  await ensureSocialLoginInitialized()
  const { SocialLogin } = await import('@capgo/capacitor-social-login')
  // Don't pass `scopes` here. @capgo/capacitor-social-login's guard
  // throws "You CANNOT use scopes without modifying the main activity"
  // whenever an explicit scopes array is present — even when those
  // scopes (email, profile) are the defaults and would be returned
  // automatically. MainActivity IS wired up to forward auth intents,
  // but the plugin's check is pre-flight: it bails out before even
  // attempting the redirect when it sees scopes. Default sign-in
  // already returns email + profile, so we just omit options entirely.
  const result = await SocialLogin.login({
    provider: 'google',
    options: {}
  })
  // Plugin response: { provider: 'google', result: { idToken, accessToken,
  // profile: { email, name, ... } } }
  const r = result?.result
  const idToken = r?.idToken
  if (!idToken) {
    throw new Error('Google did not return an idToken')
  }
  return {
    credential: idToken,
    userInfo: {
      email: r?.profile?.email || null,
      name: r?.profile?.name || null,
      avatarUrl: r?.profile?.imageUrl || null
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

// ─── Save / share a generated file (blob → user) ────────────────
//
// The web idiom (URL.createObjectURL + <a download>.click()) is a
// no-op inside Capacitor's WKWebView / Android WebView — the download
// attribute is unsupported and there's no native download manager
// wired up. Result: tapping "Export" in the native app appeared to do
// nothing.
//
// On native we write the blob to the cache directory via
// @capacitor/filesystem, then hand the resulting file URI to the
// native share sheet (@capacitor/share). The user gets the standard
// iOS/Android "Save to Photos / Save to Files / AirDrop / Mail / etc."
// picker. Cache is auto-cleaned by the OS, no manual cleanup needed.
//
// On web we keep the existing anchor-click which works in every
// browser including PWA installs.
export async function saveOrShareBlob(blob, filename, { title, dialogTitle } = {}) {
  if (isNative()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')
    // Convert blob → base64 (FileReader is the cheapest path; no native
    // streaming alternative exists in Capacitor 8 for arbitrary blobs).
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result || ''
        const comma = String(result).indexOf(',')
        resolve(comma >= 0 ? String(result).slice(comma + 1) : String(result))
      }
      reader.onerror = () => reject(reader.error || new Error('Failed to read blob'))
      reader.readAsDataURL(blob)
    })
    const writeResult = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache
    })
    return Share.share({
      title: title || filename,
      url: writeResult.uri,
      dialogTitle: dialogTitle || title || 'Save or share'
    })
  }
  // Web — programmatic anchor click. Works in PWA + every desktop
  // browser. Revoke after a tick so the download actually starts
  // before the URL becomes invalid (Safari is particularly strict here).
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
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

/**
 * Open the OS settings page for this app so the user can grant a
 * permission that was previously denied.
 *
 * Why this exists: once iOS has recorded a "Don't Allow" for Location
 * (or push, or anything else), calling the requesting plugin API again
 * does NOT re-prompt — iOS silently returns the denied state. The only
 * recovery path is for the user to flip the toggle in Settings →
 * Privacy → Location → ROAM. This helper deep-links there.
 *
 * Used by the LocationBanner retry button: if permission state is
 * 'denied' we send the user to Settings; otherwise we retry the
 * normal geolocation request which will trigger the system prompt.
 */
export async function openAppSettings() {
  if (!isNative()) return false
  const platform = getPlatform()
  try {
    if (platform === 'ios') {
      // iOS handles 'app-settings:' as a system URL scheme — opens
      // Settings directly to this app's preferences panel. We use the
      // direct location assignment (not Browser plugin) because
      // SFSafariViewController can't open non-http schemes; iOS
      // intercepts this URL at the system level instead.
      window.location.href = 'app-settings:'
      return true
    }
    if (platform === 'android') {
      // Android equivalent: package: URI opens app info / permissions.
      // Falls through to Browser plugin so Android can route via
      // Custom Tabs → system handler.
      const { Browser } = await import('@capacitor/browser')
      await Browser.open({ url: 'package:com.goroam.app' })
      return true
    }
  } catch (err) {
    console.warn('[openAppSettings] failed:', err?.message)
  }
  return false
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
    // Read the active theme from the document attribute that index.html's
    // bootstrap script set before any React mounts. After mount, the
    // ThemeContext takes over and calls applyNativeStatusBar() on every
    // theme change — but on first launch we want the status bar style
    // correct from the splash hand-off, so read it here.
    const isDark = typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-theme') === 'dark'
    // Capacitor convention is inverted from "what the user sees":
    //   Style.Light = LIGHT icons (use on DARK bg)
    //   Style.Dark  = DARK icons (use on LIGHT bg)
    await StatusBar.setStyle({ style: isDark ? Style.Light : Style.Dark })
    if (getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: isDark ? '#0d1b16' : '#1a3a2f' })
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
  nativeGoogleSignIn,
  shareContent,
  openExternalUrl,
  getCurrentPosition,
  geolocationPermissionState,
  openAppSettings,
  setPreference,
  getPreference,
  removePreference,
  hideSplashScreen,
  configureStatusBar,
  configureKeyboard,
}

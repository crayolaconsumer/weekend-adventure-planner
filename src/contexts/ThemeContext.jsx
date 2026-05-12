/**
 * Theme Context
 *
 * Tracks the user's theme preference (system / light / dark) and the
 * resolved-actual theme. The bootstrap <script> in index.html applies
 * the theme to the document BEFORE React mounts so there's no
 * flash-of-light-mode. This context's job is the runtime side:
 * settings UI, system-pref change listening, and propagating the
 * resolved theme to other components (e.g. map tile picker, status
 * bar style on native).
 *
 * Storage: localStorage 'roam_theme' = 'system' | 'light' | 'dark'.
 * Default: 'system'.
 *
 * Listens to:
 *   - prefers-color-scheme media query change (so iOS Settings →
 *     Appearance flip is honoured while the app is open)
 *
 * Side effects on theme change:
 *   - document.documentElement[data-theme] = 'dark' | (removed for light)
 *   - <meta name="theme-color"> updated for Safari address bar
 *   - StatusBar plugin style updated on Capacitor native
 */

import { createContext, useContext, useEffect, useState, useCallback } from 'react'

const STORAGE_KEY = 'roam_theme'
const ThemeContext = createContext(null)

function getSystemPrefersDark() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function getStoredPreference() {
  if (typeof localStorage === 'undefined') return 'system'
  const value = localStorage.getItem(STORAGE_KEY)
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

function resolveTheme(preference, systemDark) {
  if (preference === 'light') return 'light'
  if (preference === 'dark') return 'dark'
  return systemDark ? 'dark' : 'light'
}

function applyTheme(resolved) {
  if (typeof document === 'undefined') return
  if (resolved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
  // Keep Safari's address bar in sync. iOS WKWebView reads this on
  // load — we update it on every theme change so toggling in-app
  // updates the chrome immediately on web.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', resolved === 'dark' ? '#0d1b16' : '#1a3a2f')
  }
}

async function applyNativeStatusBar(resolved) {
  // Capacitor StatusBar plugin: light text on dark bg ↔ dark text on light.
  // Plugin import dynamically so the web bundle stays slim.
  if (typeof window === 'undefined' || !window.Capacitor?.isNativePlatform?.()) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    // Style.Light = LIGHT icons (use on dark bg); Style.Dark = dark icons.
    await StatusBar.setStyle({ style: resolved === 'dark' ? Style.Light : Style.Dark })
    if (window.Capacitor.getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: resolved === 'dark' ? '#0d1b16' : '#1a3a2f' })
    }
  } catch {
    /* plugin missing / not on native — no-op */
  }
}

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState(getStoredPreference)
  const [systemDark, setSystemDark] = useState(getSystemPrefersDark)
  const resolved = resolveTheme(preference, systemDark)

  // Apply on mount + whenever the resolved theme changes.
  useEffect(() => {
    applyTheme(resolved)
    applyNativeStatusBar(resolved)
  }, [resolved])

  // Listen for system theme changes (iOS Settings flip while app open).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e) => setSystemDark(e.matches)
    // Older Safari uses addListener instead of addEventListener
    if (mq.addEventListener) mq.addEventListener('change', handler)
    else mq.addListener(handler)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler)
      else mq.removeListener(handler)
    }
  }, [])

  const setPreference = useCallback((next) => {
    if (next !== 'light' && next !== 'dark' && next !== 'system') return
    setPreferenceState(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* unavailable */ }
  }, [])

  const value = {
    preference,            // 'system' | 'light' | 'dark' — user setting
    resolved,              // 'light' | 'dark' — actual theme in effect
    setPreference,         // setter for the user setting
    systemDark,            // current OS preference (informational)
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- Hook exported alongside provider
export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}

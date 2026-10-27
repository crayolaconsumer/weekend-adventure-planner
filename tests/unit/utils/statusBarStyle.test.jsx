import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

// Regression (27 Oct 2026): Capacitor names status bar styles by background
// (Style.Dark = light icons, Style.Light = dark icons). The app had them swapped,
// so on the default light theme every user saw white icons on cream.
const setStyle = vi.fn(async () => {})
vi.mock('@capacitor/status-bar', () => ({
  StatusBar: { setStyle: (...a) => setStyle(...a), setBackgroundColor: vi.fn(async () => {}), setOverlaysWebView: vi.fn(async () => {}) },
  Style: { Dark: 'DARK', Light: 'LIGHT', Default: 'DEFAULT' },
}))
vi.mock('../../../src/utils/nativeBridge', () => ({ isNative: () => true, getPlatform: () => 'ios' }))

beforeEach(() => {
  setStyle.mockClear()
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} }
})
afterEach(() => { delete window.Capacitor; document.documentElement.removeAttribute('data-theme') })

describe('status bar icons match the theme', () => {
  it('first launch: light theme gets dark icons (Style.Light), dark theme light icons (Style.Dark)', async () => {
    const { configureStatusBar } = await import('../../../src/utils/nativePlugins')
    document.documentElement.setAttribute('data-theme', 'light')
    await configureStatusBar()
    expect(setStyle).toHaveBeenLastCalledWith({ style: 'LIGHT' })
    document.documentElement.setAttribute('data-theme', 'dark')
    await configureStatusBar()
    expect(setStyle).toHaveBeenLastCalledWith({ style: 'DARK' })
  })

  it('theme changes: the ThemeProvider applies the same mapping', async () => {
    localStorage.setItem('roam_theme', 'light')
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    const { ThemeProvider } = await import('../../../src/contexts/ThemeContext')
    render(<ThemeProvider><div /></ThemeProvider>)
    await waitFor(() => expect(setStyle).toHaveBeenCalled())
    expect(setStyle).toHaveBeenLastCalledWith({ style: 'LIGHT' })
  })
})

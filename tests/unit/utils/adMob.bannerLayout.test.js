import { describe, it, expect, vi, beforeEach } from 'vitest'

// Regression: on Android the banner was parked above the nav using a measured
// margin that came out ~30px short on some phones, so the ad covered the menu.
// Now the banner sits at the bottom and the nav rides on top of it.
const platform = { value: 'android' }
vi.mock('../../../src/utils/nativeBridge', () => ({ isNative: () => true, getPlatform: () => platform.value }))
vi.mock('@capacitor-community/admob', () => ({ AdMob: {}, BannerAdPosition: {}, BannerAdSize: {}, BannerAdPluginEvents: {} }))

const load = async (p) => { platform.value = p; vi.resetModules(); return import('../../../src/utils/adMob') }
const root = document.documentElement

describe('native banner layout', () => {
  beforeEach(() => { document.body.className = ''; root.removeAttribute('style') })

  it('Android: banner flush at the bottom, nav lifted by the banner height', async () => {
    const { bannerMargin, reserveBannerSpace } = await load('android')
    expect(bannerMargin()).toBe(0)
    reserveBannerSpace(true)
    expect(document.body.classList.contains('native-banner-below-nav')).toBe(true)
    expect(root.style.getPropertyValue('--native-banner-bottom')).toBe('60px')
    reserveBannerSpace(false)
    expect(document.body.classList.contains('native-banner-below-nav')).toBe(false)
    expect(root.style.getPropertyValue('--native-banner-bottom')).toBe('')
  })

  it('iOS keeps the device-verified banner above the nav', async () => {
    const { bannerMargin, reserveBannerSpace } = await load('ios')
    expect(bannerMargin()).toBe(64)
    reserveBannerSpace(true)
    expect(document.body.classList.contains('native-banner-below-nav')).toBe(false)
  })

  it('the lifted nav rule exists in the stylesheet', async () => {
    const css = (await import('node:fs')).readFileSync('src/index.css', 'utf8')
    expect(css).toMatch(/body\.native-banner-below-nav \.nav-bar \{[^}]*bottom: var\(--native-banner-bottom/)
  })
})

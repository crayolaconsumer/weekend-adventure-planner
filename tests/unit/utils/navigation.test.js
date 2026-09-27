import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { directionsUrl, mapsPlatform, openMapsDirections, openDirections } from '../../../src/utils/navigation.js'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

function setUA(ua, touchPoints = 0) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touchPoints, configurable: true })
}
const native = (platform) => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => platform } }

const to = { lat: 51.5, lng: -0.12 }
const from = { lat: 51.49, lng: -0.1 }

describe('mapsPlatform', () => {
  afterEach(() => { delete window.Capacitor; vi.restoreAllMocks() })

  it('native iOS → ios, native Android → android', () => {
    setUA(DESKTOP)
    native('ios'); expect(mapsPlatform()).toBe('ios')
    native('android'); expect(mapsPlatform()).toBe('android')
  })
  it('iPhone Safari → ios', () => { setUA(IPHONE); expect(mapsPlatform()).toBe('ios') })
  it('iPad in desktop mode (Mac UA + touch) → ios', () => { setUA(IPAD_DESKTOP, 5); expect(mapsPlatform()).toBe('ios') })
  it('a real Mac → web', () => { setUA(IPAD_DESKTOP, 0); expect(mapsPlatform()).toBe('web') })
  it('Android Chrome → android', () => { setUA(ANDROID); expect(mapsPlatform()).toBe('android') })
  it('desktop → web', () => { setUA(DESKTOP); expect(mapsPlatform()).toBe('web') })
})

describe('directionsUrl', () => {
  it('iOS: Apple Maps with daddr, saddr and dirflg', () => {
    const u = new URL(directionsUrl({ to, from, mode: 'walk' }, 'ios'))
    expect(u.origin).toBe('https://maps.apple.com')
    expect(u.searchParams.get('daddr')).toBe('51.5,-0.12')
    expect(u.searchParams.get('saddr')).toBe('51.49,-0.1')
    expect(u.searchParams.get('dirflg')).toBe('w')
    expect(new URL(directionsUrl({ to, mode: 'drive' }, 'ios')).searchParams.get('dirflg')).toBe('d')
    expect(new URL(directionsUrl({ to, mode: 'transit' }, 'ios')).searchParams.get('dirflg')).toBe('r')
  })

  it('iOS without origin or mode starts from "here" with the user\'s default mode', () => {
    const u = new URL(directionsUrl({ to }, 'ios'))
    expect(u.searchParams.has('saddr')).toBe(false)
    expect(u.searchParams.has('dirflg')).toBe(false)
  })

  it('iOS multi-stop stays on Google Maps (Apple takes one destination)', () => {
    const u = new URL(directionsUrl({ from, to, via: [{ lat: 1, lng: 2 }], mode: 'walk' }, 'ios'))
    expect(u.host).toBe('www.google.com')
    expect(u.searchParams.get('waypoints')).toBe('1,2')
  })

  it('Android and desktop: Google Maps universal URL', () => {
    for (const platform of ['android', 'web']) {
      const u = new URL(directionsUrl({ to, from, mode: 'transit' }, platform))
      expect(u.host + u.pathname).toBe('www.google.com/maps/dir/')
      expect(u.searchParams.get('api')).toBe('1')
      expect(u.searchParams.get('destination')).toBe('51.5,-0.12')
      expect(u.searchParams.get('origin')).toBe('51.49,-0.1')
      expect(u.searchParams.get('travelmode')).toBe('transit')
    }
  })

  it('accepts an address destination', () => {
    expect(new URL(directionsUrl({ to: '1 High St, York' }, 'ios')).searchParams.get('daddr')).toBe('1 High St, York')
    expect(new URL(directionsUrl({ to: '1 High St, York' }, 'web')).searchParams.get('destination')).toBe('1 High St, York')
  })
})

describe('openMapsDirections', () => {
  let hrefSet, openSpy
  beforeEach(() => {
    hrefSet = vi.fn()
    vi.stubGlobal('location', { set href(v) { hrefSet(v) } })
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
  })
  afterEach(() => { delete window.Capacitor; vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('native iOS navigates in place to Apple Maps (Capacitor hands it to the OS)', () => {
    setUA(DESKTOP); native('ios')
    openDirections(51.5, -0.12, 'Somewhere', 'walk')
    expect(hrefSet).toHaveBeenCalledWith('https://maps.apple.com/?daddr=51.5%2C-0.12&dirflg=w')
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('native Android navigates in place to Google Maps', () => {
    setUA(ANDROID); native('android')
    openMapsDirections({ to })
    expect(hrefSet.mock.calls[0][0]).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\//)
  })

  // Regression: same-window navigation on mobile web unloaded Plan and lost
  // an unsaved itinerary. Web always opens a new tab.
  it('iPhone Safari opens Apple Maps in a new tab, keeping the page', () => {
    setUA(IPHONE)
    openMapsDirections({ to })
    expect(hrefSet).not.toHaveBeenCalled()
    expect(openSpy.mock.calls[0][0]).toMatch(/^https:\/\/maps\.apple\.com\//)
    expect(openSpy.mock.calls[0][1]).toBe('_blank')
  })

  it('Android Chrome opens Google Maps in a new tab, keeping the page', () => {
    setUA(ANDROID)
    openMapsDirections({ to })
    expect(hrefSet).not.toHaveBeenCalled()
    expect(openSpy.mock.calls[0][0]).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\//)
  })

  it('desktop opens Google Maps web in a new tab', () => {
    setUA(DESKTOP)
    openMapsDirections({ to })
    expect(hrefSet).not.toHaveBeenCalled()
    expect(openSpy.mock.calls[0][0]).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\//)
    expect(openSpy.mock.calls[0][1]).toBe('_blank')
  })
})

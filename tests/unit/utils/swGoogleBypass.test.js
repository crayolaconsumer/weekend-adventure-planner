import process from 'node:process'
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// public/sw.js is a plain script, so pull the matcher out of its source
const src = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8')
const block = src.slice(src.indexOf('const GOOGLE_MAPS_HOST'), src.indexOf('// Check if request is an API call'))
const isGoogleMapsRequest = new Function(`${block}; return isGoogleMapsRequest`)()
const hit = u => isGoogleMapsRequest(new URL(u))

describe('service worker: Google Places content skips our caches', () => {
  it.each([
    'https://maps.googleapis.com/maps/api/js?key=k&v=weekly',
    'https://maps.googleapis.com/maps-api-v3/api/js/66/6c/intl/en_gb/main.js',
    'https://places.googleapis.com/$rpc/google.maps.places.v1.Places/GetPlace',
    'https://maps.gstatic.com/mapfiles/x.png',
    // Real place photo URL shape seen from the UI Kit card
    'https://lh3.googleusercontent.com/grass-cs/AABkmLfcIqXhWg',
  ])('bypasses %s', u => expect(hit(u)).toBe(true))

  it.each([
    // Google sign-in avatars keep their image caching
    'https://lh3.googleusercontent.com/a/ACg8ocKxyz=s96-c',
    'https://lh3.googleusercontent.com/a-/AOh14Gxyz',
    // Web fonts keep their static caching
    'https://fonts.gstatic.com/s/outfit/v15/x.woff2',
    'https://fonts.googleapis.com/css2?family=Outfit',
    'https://www.go-roam.uk/assets/index.js',
  ])('leaves %s alone', u => expect(hit(u)).toBe(false))

  it('checks it before the static and image caches', () => {
    const strategy = src.slice(src.indexOf('async function defaultFetchStrategy'))
    expect(strategy.indexOf('isGoogleMapsRequest(url)')).toBeLessThan(strategy.indexOf('isImageRequest(url, request)'))
    expect(strategy.indexOf('isGoogleMapsRequest(url)')).toBeLessThan(strategy.indexOf('isStaticAsset(url)'))
  })
})

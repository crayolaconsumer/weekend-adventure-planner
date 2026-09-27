import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolvePlaceImageWithMeta, resolvePlaceImageAsync } from '../../../src/utils/placeImage.js'

// No real photo must mean no photo (the branded category gradient), never
// an unrelated Unsplash stock shot of somewhere else.
afterEach(() => vi.unstubAllGlobals())

describe('placeImage without a real photo', () => {
  it('returns null when the resolver finds nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ url: null }) })))
    const place = { id: 'no-photo-1', name: 'Quiet Garden', category: 'nature', lat: 51.5, lng: -0.1 }
    expect(await resolvePlaceImageWithMeta(place)).toBe(null)
  })

  it('returns null when the resolver is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const place = { id: 'no-photo-2', name: 'Costa', category: 'food', lat: 51.51, lng: -0.12 }
    expect(await resolvePlaceImageAsync(place)).toBe(null)
  })

  it('still returns a real photo already on the place', async () => {
    const place = { id: 'has-photo', name: 'Minster', photo: 'https://upload.wikimedia.org/m.jpg' }
    expect(await resolvePlaceImageAsync(place)).toBe('https://upload.wikimedia.org/m.jpg')
  })
})

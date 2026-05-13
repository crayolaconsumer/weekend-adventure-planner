import { describe, it, expect } from 'vitest'
import {
  scoreImage,
  selectBestImage,
  createImageMeta,
  isValidImageUrl,
} from '../../../src/utils/imageScoring.js'

describe('scoreImage', () => {
  it('returns 0 for missing url', () => {
    expect(scoreImage({}).qualityScore).toBe(0)
    expect(scoreImage(null).qualityScore).toBe(0)
    expect(scoreImage({ url: null }).qualityScore).toBe(0)
  })

  it('user uploads outscore placeholder', () => {
    const user = scoreImage({ url: 'https://x/y.jpg', source: 'user' })
    const placeholder = scoreImage({ url: 'https://x/y.jpg', source: 'placeholder' })
    expect(user.qualityScore).toBeGreaterThan(placeholder.qualityScore)
  })

  it('Wikipedia outscores OpenTripMap', () => {
    const wiki = scoreImage({ url: 'https://x/y.jpg', source: 'wikipedia' })
    const otm = scoreImage({ url: 'https://x/y.jpg', source: 'opentripmap' })
    expect(wiki.qualityScore).toBeGreaterThan(otm.qualityScore)
  })

  it('large resolution adds bonus', () => {
    const small = scoreImage({ url: 'https://x/y.jpg', source: 'wikipedia', width: 300 })
    const big = scoreImage({ url: 'https://x/y.jpg', source: 'wikipedia', width: 1500 })
    expect(big.qualityScore).toBeGreaterThan(small.qualityScore)
  })

  it('penalises extreme aspect ratios', () => {
    const square = scoreImage({ url: 'https://x/y.jpg', source: 'wikipedia', width: 800, height: 600 })
    const tooNarrow = scoreImage({ url: 'https://x/y.jpg', source: 'wikipedia', width: 100, height: 400 })
    expect(square.qualityScore).toBeGreaterThan(tooNarrow.qualityScore)
  })

  it('clamps to 0-100', () => {
    const result = scoreImage({ url: 'https://x/large.jpg', source: 'user', width: 2000, height: 1500 })
    expect(result.qualityScore).toBeLessThanOrEqual(100)
    expect(result.qualityScore).toBeGreaterThanOrEqual(0)
  })

  it('penalises thumbnail URLs', () => {
    const normal = scoreImage({ url: 'https://x/photo.jpg', source: 'wikipedia' })
    const thumb = scoreImage({ url: 'https://x/photo_thumb.jpg', source: 'wikipedia' })
    expect(normal.qualityScore).toBeGreaterThan(thumb.qualityScore)
  })

  it('preserves passed-through fields', () => {
    const result = scoreImage({ url: 'https://x/y.jpg', source: 'wikipedia', extra: 'foo' })
    expect(result.extra).toBe('foo')
    expect(typeof result.scoredAt).toBe('number')
  })
})

describe('selectBestImage', () => {
  it('returns null for empty/missing input', () => {
    expect(selectBestImage([])).toBe(null)
    expect(selectBestImage(null)).toBe(null)
  })

  it('picks the highest-scoring candidate', () => {
    const result = selectBestImage([
      { url: 'https://x/thumb.jpg', source: 'placeholder' },
      { url: 'https://x/full.jpg', source: 'user', width: 1200, height: 800 },
      { url: 'https://x/wiki.jpg', source: 'wikipedia' },
    ])
    expect(result.url).toBe('https://x/full.jpg')
  })

  it('drops candidates without url before scoring', () => {
    const result = selectBestImage([
      { source: 'user' },
      { url: 'https://x/y.jpg', source: 'wikipedia' },
    ])
    expect(result.url).toBe('https://x/y.jpg')
  })
})

describe('createImageMeta', () => {
  it('builds a meta object with defaults', () => {
    const meta = createImageMeta('https://x/y.jpg', 'wikipedia')
    expect(meta.url).toBe('https://x/y.jpg')
    expect(meta.source).toBe('wikipedia')
    expect(meta.width).toBe(null)
    expect(meta.height).toBe(null)
  })

  it('spreads extras', () => {
    const meta = createImageMeta('https://x/y.jpg', 'user', { width: 1000, height: 800, alt: 'foo' })
    expect(meta.width).toBe(1000)
    expect(meta.alt).toBe('foo')
  })
})

describe('isValidImageUrl', () => {
  it('accepts urls with image extensions', () => {
    expect(isValidImageUrl('https://x.com/photo.jpg')).toBe(true)
    expect(isValidImageUrl('https://x.com/photo.png')).toBe(true)
    expect(isValidImageUrl('https://x.com/photo.webp')).toBe(true)
  })

  it('accepts known image hosts', () => {
    expect(isValidImageUrl('https://upload.wikimedia.org/anything')).toBe(true)
    expect(isValidImageUrl('https://images.unsplash.com/anything')).toBe(true)
  })

  it('rejects non-http(s)', () => {
    expect(isValidImageUrl('ftp://x/y.jpg')).toBe(false)
    expect(isValidImageUrl('data:image/png;base64,foo')).toBe(false)
  })

  it('rejects garbage', () => {
    expect(isValidImageUrl('')).toBe(false)
    expect(isValidImageUrl(null)).toBe(false)
    expect(isValidImageUrl('not a url')).toBe(false)
  })

  it('rejects non-image paths from unknown hosts', () => {
    expect(isValidImageUrl('https://example.com/page.html')).toBe(false)
  })
})

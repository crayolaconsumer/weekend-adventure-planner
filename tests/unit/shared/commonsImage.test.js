// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { sizedImageUrl } from '../../../shared/commonsImage.mjs'
import { parseOverpassResponse } from '../../../src/utils/apiClient.js'

// Regression: OSM image= tags hold Commons ORIGINALS (1.6 MB, 2.4 MB seen in
// the UK build) that loaded "dial-up style" on a Pixel. Cards and offline
// packs get Wikimedia's 960 px thumbnail (same CORS-open host) instead.
const T = 'https://upload.wikimedia.org/wikipedia/commons/thumb'
describe('sizedImageUrl', () => {
  it('rewrites a Commons original to its 960 px thumbnail, keeping the name exactly as encoded', () => {
    expect(sizedImageUrl('https://upload.wikimedia.org/wikipedia/commons/f/f5/Casablanca_Public_House%2C_East_Grinstead.jpg'))
      .toBe(`${T}/f/f5/Casablanca_Public_House%2C_East_Grinstead.jpg/960px-Casablanca_Public_House%2C_East_Grinstead.jpg`)
    for (const ext of ['jpeg', 'JPEG', 'webp', 'gif', 'png']) expect(sizedImageUrl(`https://upload.wikimedia.org/wikipedia/commons/a/ab/X.${ext}`)).toBe(`${T}/a/ab/X.${ext}/960px-X.${ext}`)
    expect(sizedImageUrl('https://upload.wikimedia.org/wikipedia/commons/a/ab/Map.SVG')).toBe(`${T}/a/ab/Map.SVG/960px-Map.SVG.png`)
    expect(sizedImageUrl(' https://upload.wikimedia.org/wikipedia/commons/1/1c/Brownsea_Island.JPG '))
      .toBe(`${T}/1/1c/Brownsea_Island.JPG/960px-Brownsea_Island.JPG`)
    expect(sizedImageUrl('https://upload.wikimedia.org/wikipedia/commons/a/ab/Map.svg')).toBe(`${T}/a/ab/Map.svg/960px-Map.svg.png`)
  })

  it.each([
    'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Church.jpg/240px-Church.jpg',
    'https://upload.wikimedia.org/wikipedia/en/1/1c/Local_file.jpg',
    'https://example.com/pub.jpg',
    'https://upload.wikimedia.org/wikipedia/commons/1/1c/X.jpg?download',
    'https://upload.wikimedia.org/wikipedia/commons/1/1c/Scan.tif',
    // Geograph uploads are small; the 960 px thumb would upscale them (106 KB -> 247 KB)
    'https://upload.wikimedia.org/wikipedia/commons/f/f5/Casablanca_Public_House%2C_East_Grinstead_-_geograph.org.uk_-_2955664.jpg',
    'https://upload.wikimedia.org/wikipedia/commons/1/1c/Leaflet.pdf',
    undefined,
    '',
  ])('leaves %s unchanged', url => {
    expect(sizedImageUrl(url)).toBe(url)
  })

  it('the deck gets the thumbnail, not the original', () => {
    const [place] = parseOverpassResponse({ elements: [{ type: 'node', id: 1, lat: 53.96, lon: -1.08,
      tags: { name: 'The Pub', amenity: 'pub', image: 'https://upload.wikimedia.org/wikipedia/commons/3/3a/The_Pub.jpg' } }] }, 53.96, -1.08)
    expect(place.image).toBe(`${T}/3/3a/The_Pub.jpg/960px-The_Pub.jpg`)
  })
})

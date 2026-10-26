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

  // Regression (26 Oct 2026): Commons' imageinfo API returns originals with utm tracking
  // params, which skipped the rewrite, so Discover cards downloaded multi-MB files
  it('still sizes an original that carries only utm_* tracking params', () => {
    expect(sizedImageUrl('https://upload.wikimedia.org/wikipedia/commons/7/71/Image-Grand_central_Station_Outside_Night_2.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original'))
      .toBe(`${T}/7/71/Image-Grand_central_Station_Outside_Night_2.jpg/960px-Image-Grand_central_Station_Outside_Night_2.jpg`)
    // a real query (not tracking) is still left alone
    expect(sizedImageUrl('https://upload.wikimedia.org/wikipedia/commons/1/1c/X.jpg?utm_source=a&download')).toBe('https://upload.wikimedia.org/wikipedia/commons/1/1c/X.jpg?utm_source=a&download')
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

// Regression: the Wikidata P18 path returned Commons' imageinfo ORIGINAL (multi-MB)
describe('fetchWikidataImageInfo', () => {
  const withFetch = async (imageinfo, run) => {
    const real = globalThis.fetch
    const urls = []
    globalThis.fetch = async url => { urls.push(String(url)); return { ok: true, json: async () => String(url).includes('wikidata.org')
      ? { entities: { Q1: { claims: { P18: [{ mainsnak: { datavalue: { value: 'GCT.jpg' } } }] } } } }
      : { query: { pages: { 1: { imageinfo: [imageinfo] } } } } } }
    try { return await run(urls) } finally { globalThis.fetch = real }
  }
  it("asks Commons for its 960 px thumbnail and returns it with the thumbnail's size", async () => {
    const { fetchWikidataImageInfo, fetchWikidataImage } = await import('../../../src/utils/apiClient/wikipedia.ts')
    const thumb = `${T}/7/71/GCT.jpg/960px-GCT.jpg`
    await withFetch({ url: 'https://upload.wikimedia.org/wikipedia/commons/7/71/GCT.jpg?utm_content=original', width: 4000, height: 3000, thumburl: thumb, thumbwidth: 960, thumbheight: 720 }, async urls => {
      expect(await fetchWikidataImageInfo('Q1')).toEqual({ url: thumb, width: 960, height: 720 })
      expect(urls.find(u => u.includes('commons.wikimedia.org/w/api.php'))).toContain('iiurlwidth=960')
      expect(await fetchWikidataImage('Q1')).toBe(thumb)
    })
  })
  it('falls back to the original only when Commons gives no thumbnail', async () => {
    const { fetchWikidataImageInfo } = await import('../../../src/utils/apiClient/wikipedia.ts')
    await withFetch({ url: 'https://upload.wikimedia.org/wikipedia/commons/7/71/S.jpg', width: 500, height: 400 }, async () => {
      expect(await fetchWikidataImageInfo('Q1')).toEqual({ url: 'https://upload.wikimedia.org/wikipedia/commons/7/71/S.jpg', width: 500, height: 400 })
    })
  })
  // The critic's case: with its width the 960 px Commons thumb outranks the 330 px Wikipedia thumb
  it('the sized Wikidata image still beats the 330 px Wikipedia thumbnail when scored', async () => {
    const { scoreImage } = await import('../../../src/utils/imageScoring.ts')
    const wikidata = scoreImage({ url: `${T}/7/71/GCT.jpg/960px-GCT.jpg`, source: 'wikidata', width: 960, height: 720 })
    const wikipedia = scoreImage({ url: `${T}/7/71/GCT.jpg/330px-GCT.jpg`, source: 'wikipedia', width: 330, height: 248 })
    expect(wikidata.qualityScore).toBeGreaterThan(wikipedia.qualityScore)
  })
})

// The utm strip must stay linear: a nested quantifier here once took minutes on a 255-char OSM tag
it('sizedImageUrl stays fast on hostile utm-heavy input', () => {
  const evil = 'https://upload.wikimedia.org/wikipedia/commons/1/1c/X.jpg?' + 'utm_a='.repeat(60) + '#'
  const t = performance.now()
  sizedImageUrl(evil)
  expect(performance.now() - t).toBeLessThan(50)
})

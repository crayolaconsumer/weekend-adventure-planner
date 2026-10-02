import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { trimOverpassResponse, TAG_WHITELIST } from '../../../api/lib/overpassTrim.js'
import { placeScore } from '../../../api/lib/towns.js'
import { pickPlaceElement } from '../../../shared/osmPick.mjs'

// The proxy trims tags before caching and responding. Anything a client reads
// that the trim drops silently degrades Discover or the town pages.

const way = {
  type: 'way', id: 1, center: { lat: 51.5, lon: -0.1 }, bounds: { minlat: 51.49, minlon: -0.11, maxlat: 51.51, maxlon: -0.09 },
  nodes: [1, 2, 3],
  tags: { name: 'Hyde Park', 'name:fr': 'Hyde Park', 'name:de': 'Hyde Park', leisure: 'park', wikidata: 'Q1', 'addr:town': 'London', 'source:geometry': 'survey', 'check_date': '2024-01-01', 'fixme': 'x' },
}

describe('trimOverpassResponse', () => {
  it('keeps what Discover and the town pages read, drops the rest', () => {
    const [el] = trimOverpassResponse({ version: 0.6, elements: [way] }).elements
    expect(el.bounds).toEqual(way.bounds)
    expect(el.center).toEqual(way.center)
    expect(el.nodes).toBeUndefined()
    expect(el.tags).toEqual({ name: 'Hyde Park', 'name:fr': 'Hyde Park', 'name:de': 'Hyde Park', leisure: 'park', wikidata: 'Q1', 'addr:town': 'London' })
  })

  it('leaves town-page ranking unchanged (fame = name:xx count)', () => {
    const [el] = trimOverpassResponse({ elements: [way] }).elements
    expect(placeScore(el.tags)).toBe(placeScore(way.tags))
  })

  it('a road sharing a bare id with an unnamed node still never resolves as a place (regression: highway dropped)', () => {
    const road = { type: 'way', id: 7, center: { lat: 1, lon: 1 }, tags: { name: 'High Street', highway: 'primary' } }
    const node = { type: 'node', id: 7, lat: 1, lon: 1 }
    expect(pickPlaceElement(trimOverpassResponse({ elements: [node, road] }).elements)).toBeNull()
  })

  it('returns anything unexpected untouched', () => {
    expect(trimOverpassResponse(null)).toBe(null)
    expect(trimOverpassResponse({ remark: 'timeout' })).toEqual({ remark: 'timeout' })
  })

  it('whitelists every literal tag key the app and town pages read', () => {
    const files = []
    const walk = d => readdirSync(d).forEach(f => {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(jsx?|tsx?|mjs)$/.test(f)) files.push(p)
    })
    ;['src', 'shared', 'api/lib', 'api/town.js'].forEach(p => statSync(p).isDirectory() ? walk(p) : files.push(p))
    const read = new Set()
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/\btags\??\.?\[['"]([^'"]+)['"]\]/g)) read.add(m[1])
      for (const m of src.matchAll(/\btags\??\.([a-z_]+)\b/g)) read.add(m[1])
    }
    const missing = [...read].filter(k => !TAG_WHITELIST.has(k) && !k.startsWith('name:'))
    expect(missing).toEqual([])
  })
})

describe('trimOverpassResponse drops what the phone never deals', () => {
  // Regression: a 26k-element tile gzipped to 1.56 MB (over the 900 KB KV cap), so it was
  // never cached and every load went back to Overpass for 15 s. Nameless elements were most of it.
  it('drops exactly the nameless elements (each one the phone SKIPs too), on real OSM rows', async () => {
    const { poiFeatures, SKIP } = await import('../../../shared/poiRank.mjs')
    const sample = JSON.parse(readFileSync('tests/fixtures/poiRankSample.json', 'utf8'))
    const edge = [
      { type: 'node', id: 1, lat: 51.5, lon: 0, tags: { name: 'On the meridian', amenity: 'cafe' } },
      { type: 'node', id: 2, lat: 51.5, lon: -0.1, tags: { amenity: 'cafe' } },
      { type: 'node', id: 3, lat: 51.5, lon: -0.1, tags: { 'name:en': 'English only', amenity: 'cafe' } },
      { type: 'way', id: 4, center: { lat: 51.5, lon: -0.1 }, tags: { name: 'Way', leisure: 'park' } },
      { type: 'node', id: 5, lat: 51.5, lon: -0.1 },
    ]
    const all = [...sample, ...edge]
    const kept = new Set(trimOverpassResponse({ elements: all }).elements.map(e => `${e.type}/${e.id}`))
    for (const el of all) {
      const named = Boolean(el.tags?.name || el.tags?.['name:en'])
      expect(kept.has(`${el.type}/${el.id}`), `${el.type}/${el.id}`).toBe(named)
      if (!named) expect(poiFeatures(el).flags & SKIP).toBeTruthy()
    }
    expect(kept.size).toBeLessThan(all.length)
  })
})

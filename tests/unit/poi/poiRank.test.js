// @vitest-environment node
/**
 * shared/poiRank.mjs is a port of the phone's deck logic. These tests pin it to
 * the client's own functions (src/utils/categories.ts, placeFilter.js,
 * badges.js, apiClient.js parseOverpassResponse) on real OSM rows
 * (tests/fixtures/poiRankSample.json: 618 elements sampled from the London 30 km,
 * Manchester 15 km and York 5 km DB answers, every type plus the edge cases:
 * blacklisted, boring, branded, chains by name, access, hours, name:en only,
 * ways), so a change on either side fails CI instead of silently skewing the cap.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import process from 'node:process'
import { GOOD_CATEGORY_TYPES } from '../../../shared/overpassQuery.js'
import { haversineKm } from '../../../shared/geo.mjs'
import { parseOverpassResponse } from '../../../src/utils/apiClient.js'
import { scorePlace, filterPlaces, DECK_WEIGHTS } from '../../../src/utils/placeFilter.js'
import { BLACKLIST as CLIENT_BLACKLIST, BORING_NAME_PATTERNS, getCategoryForType, isBlacklisted as clientBlacklisted, hasBoringName as clientBoring } from '../../../src/utils/categories.ts'
import { KNOWN_CHAINS as CLIENT_CHAINS, isChainPlace, CHAIN_PENALTY as CLIENT_CHAIN_PENALTY } from '../../../src/utils/badges.js'
import {
  BLACKLIST, BORING_PATTERNS, KNOWN_CHAINS, CATEGORY_KEYS, categoryCode, isBlacklisted, hasBoringName, isChain, rawScore,
  poiFeatures, openSlots, rankCap, BOOST, ELIGIBLE, HAS_HOURS, OPEN_MASK, SKIP,
  MIN_SCORE, CHAIN_PENALTY, FEATURES_VERSION, ZONE_DEG, NEAREST, OPEN_NOW, CLOSED_NOW,
} from '../../../shared/poiRank.mjs'

// Plus hand-made cases the answers don't hold: nightlife (no Discover radius asks for
// nightclubs), a branded museum (a destination, not a chain), rescued blacklisted/boring places
const SYNTHETIC = [
  { type: 'node', id: 9001, lat: 51.51, lon: -0.13, tags: { name: 'Fabric', amenity: 'nightclub', opening_hours: 'Fr-Sa 23:00-06:00' } },
  { type: 'node', id: 9002, lat: 51.51, lon: -0.13, tags: { name: 'Madame Tussauds', tourism: 'museum', brand: 'Madame Tussauds', wikidata: 'Q1' } },
  { type: 'node', id: 9003, lat: 51.51, lon: -0.13, tags: { name: 'Westminster Abbey', amenity: 'place_of_worship', tourism: 'attraction', wikipedia: 'en:Westminster Abbey' } },
  { type: 'node', id: 9004, lat: 51.51, lon: -0.13, tags: { name: 'Old Bank of England Pub', amenity: 'pub', heritage: '2' } },
  { type: 'node', id: 9005, lat: 51.51, lon: -0.13, tags: { name: 'Costa Coffee Soho', amenity: 'cafe', access: 'customers' } },
  { type: 'node', id: 9006, lat: 51.51, lon: -0.13, tags: { name: 'Members Garden', leisure: 'garden', access: 'private', website: 'https://x.org' } },
]
const SAMPLE = [...JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'poiRankSample.json'), 'utf8')), ...SYNTHETIC]
const typeOf = t => t.amenity || t.tourism || t.leisure || t.historic || t.shop || t.natural || t.man_made || t.landuse || 'place'
const clamp = s => Math.max(0, Math.min(100, s))
// Each element as the phone parses it, next to its tags
const PARSED = SAMPLE.map(el => ({ el, t: el.tags, place: parseOverpassResponse({ elements: [el] })[0] }))
// No time-of-day / weather boost: 'none' is not a TIME_BOOSTS key
const NEUTRAL = { timeContext: 'none' }

describe('pinned to the client: the lists are the same lists', () => {
  it('BLACKLIST, BORING_NAME_PATTERNS and KNOWN_CHAINS match the client exactly', () => {
    expect(BLACKLIST).toEqual(CLIENT_BLACKLIST)
    expect(BORING_PATTERNS.map(r => r.source)).toEqual(BORING_NAME_PATTERNS.map(r => r.source))
    for (const r of BORING_NAME_PATTERNS) expect(r.flags).toBe('i') // ours are joined under one i flag
    expect(KNOWN_CHAINS).toEqual(CLIENT_CHAINS)
  })

  it('the deck constants are the client\'s: nearness and open-now weights, zone size, chain penalty, minScore', () => {
    expect(NEAREST).toBe(DECK_WEIGHTS.nearest)
    expect(OPEN_NOW).toBe(DECK_WEIGHTS.openNow)
    expect(CLOSED_NOW).toBe(DECK_WEIGHTS.closedNow)
    expect(CHAIN_PENALTY).toBe(CLIENT_CHAIN_PENALTY)
    // not exported by the client, so read from its source
    const src = f => readFileSync(join(process.cwd(), f), 'utf8')
    expect(Number(/function getGeoZone\(place, precision = ([\d.]+)\)/.exec(src('src/utils/placeFilter.js'))[1])).toBe(ZONE_DEG)
    expect(src('src/utils/placeFilter.js')).toMatch(/getGeoZone\(place\)/) // called with the default
    // Discover.jsx no longer calls filterPlaces directly (the dead
    // load-more call is gone); the deck's minScore lives in
    // applyFilters.ts and must stay a superset of the poi's
    const main = [...src('src/pages/Discover/applyFilters.ts').matchAll(/minScore: (\d+)/g)].map(m => Number(m[1]))
    expect(main.length).toBeGreaterThan(0)
    for (const m of main) expect(m).toBeGreaterThanOrEqual(MIN_SCORE)
  })

  it('the sample covers what it claims', () => {
    expect(SAMPLE.length).toBeGreaterThan(500)
    expect(new Set(PARSED.map(p => categoryCode(typeOf(p.t)))).size).toBe(CATEGORY_KEYS.length + 1) // every category + other
    expect(PARSED.filter(p => p.t.brand).length).toBeGreaterThan(10)
    expect(PARSED.filter(p => hasBoringName(p.place?.name)).length).toBeGreaterThan(10)
    expect(PARSED.filter(p => ['private', 'no'].includes(p.t.access)).length).toBeGreaterThan(5)
    expect(PARSED.filter(p => p.t.opening_hours).length).toBeGreaterThan(30)
    expect(PARSED.filter(p => p.el.type === 'way').length).toBeGreaterThan(10)
  })
})

describe('pinned to the client: per place, on real rows', () => {
  it('category: categoryCode is getCategoryForType, for every good type and every sampled type', () => {
    const types = new Set([...Object.values(GOOD_CATEGORY_TYPES).flat(), ...PARSED.map(p => typeOf(p.t)), 'place', 'bank'])
    for (const type of types) expect(CATEGORY_KEYS[categoryCode(type) - 1] ?? null, type).toBe(getCategoryForType(type)?.key ?? null)
  })

  it('type: the same tag decides it as parseOverpassResponse', () => {
    for (const { t, place } of PARSED) expect(typeOf(t)).toBe(place.type)
  })

  it('blacklist and boring names agree with categories.ts', () => {
    for (const { place } of PARSED) {
      expect(isBlacklisted(place.type), place.type).toBe(clientBlacklisted(place.type))
      expect(hasBoringName(place.name), place.name).toBe(clientBoring(place.name))
    }
    for (const word of CLIENT_BLACKLIST) expect(isBlacklisted(word)).toBe(true)
  })

  it('chain: isChain is badges.js isChainPlace on the parsed place', () => {
    let chains = 0
    for (const { t, place } of PARSED) {
      const ours = isChain(t, place.type, place.name)
      expect(ours, place.name).toBe(isChainPlace(place))
      chains += ours
    }
    expect(chains).toBeGreaterThan(20)
  })

  it('score: q is scorePlace (chain penalty and clamp included), with and without a +20 vibe boost', () => {
    for (const { el, t, place } of PARSED) {
      const raw = rawScore(t, place.type, place.name)
      const chain = isChainPlace(place)
      const after = s => (chain ? Math.max(0, clamp(s) - 30) : clamp(s))
      expect(after(raw), place.name).toBe(scorePlace(place, NEUTRAL))
      const cat = getCategoryForType(place.type)
      if (cat) {
        expect(after(raw + 20), place.name).toBe(scorePlace(place, { ...NEUTRAL, vibeCategories: [cat.key] }))
        // and the stored q is that score with the cap's own boost: 25, the value the rank eval
        // was tuned on (a literal here, so changing BOOST is a deliberate, re-evaluated act)
        expect(poiFeatures(el).q).toBe(after(raw + 25))
      } else {
        expect(poiFeatures(el).q).toBe(after(raw))
      }
    }
  })

  it('eligible: filterPlaces keeps it (access, blacklist, boring name, their rescues) and its boosted score is >= 25', () => {
    let eligible = 0
    for (const { el, t, place } of PARSED) {
      const kept = filterPlaces([place], { minScore: 0, maxResults: 5, sortBy: 'name', ensureDiversity: false }).length === 1
      const boosted = clamp(rawScore(t, place.type, place.name) + (categoryCode(place.type) ? 25 : 0))
      const flag = (poiFeatures(el).flags & ELIGIBLE) !== 0
      expect(flag, place.name).toBe(kept && boosted >= 25)
      eligible += flag
    }
    expect(eligible).toBeGreaterThan(PARSED.length / 2)
    expect(eligible).toBeLessThan(PARSED.length)
  })

  it('skip: exactly the elements the phone drops on parse', () => {
    const edge = [
      { type: 'node', id: 1, lat: 51.5, lon: 0, tags: { name: 'On the meridian', amenity: 'cafe' } }, // lng 0 is falsy on the phone
      { type: 'node', id: 2, lat: 51.5, lon: -0.1, tags: { amenity: 'cafe' } },
      { type: 'node', id: 3, lat: 51.5, lon: -0.1, tags: { 'name:en': 'English only', amenity: 'cafe' } },
      { type: 'way', id: 4, center: { lat: 51.5, lon: -0.1 }, tags: { name: 'Way', leisure: 'park' } },
    ]
    for (const el of [...SAMPLE, ...edge]) {
      const kept = parseOverpassResponse({ elements: [el] }).length === 1
      expect((poiFeatures(el).flags & SKIP) !== 0, JSON.stringify(el).slice(0, 80)).toBe(!kept)
    }
  })
})

describe('features', () => {
  // What poiFeatures writes for every sample row, per FEATURES_VERSION. Builds and live
  // tables carry these numbers under that version: changing poiFeatures' output without
  // bumping FEATURES_VERSION would let the server rank old rows with new meanings. Changed
  // the output on purpose? Bump FEATURES_VERSION and add its digest here.
  const DIGESTS = {
    1: 'c4b358fa6ea34ebc17501373dacf1aff60d125d25b9c3a67ee6ab60fee2a43f1',
    // v2: blacklisted types lost the -100 score penalty (rescued places
    // rank on their merits); the client and this port changed together.
    2: 'f8b695f8f6c01facd9decbbf0754d217f822f194f2191d56ce7dcdbf3e5775b2',
  }
  it(`the output for FEATURES_VERSION ${FEATURES_VERSION} is frozen`, () => {
    const file = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'poiRankSample.json'), 'utf8'))
    const out = file.map(el => { const f = poiFeatures(el); return `${el.type}/${el.id} ${f.q} ${f.cat} ${f.flags}` }).join('\n')
    expect(createHash('sha256').update(out).digest('hex')).toBe(DIGESTS[FEATURES_VERSION])
  })

  it('BOOST is the tuned 25 (see the score pin); a change must re-run tests/evals/rankCap.eval.js', () => {
    expect(BOOST).toBe(25)
  })

  it('fit their TINYINT UNSIGNED columns', () => {
    for (const { el } of PARSED) {
      const { q, cat, flags } = poiFeatures(el)
      for (const v of [q, cat, flags]) expect(Number.isInteger(v) && v >= 0 && v <= 255).toBe(true)
      expect(q).toBeLessThanOrEqual(100)
    }
  })

  it('opening hours: bit k = open at SLOTS[k] (03:00, 08:00, 12:30, 19:00, 23:30); no hours = no HAS_HOURS bit', () => {
    expect(openSlots('24/7')).toBe(0b11111)
    expect(openSlots('Mo-Su 08:00-18:00')).toBe(0b00110)
    expect(openSlots('Fr-Sa 17:00-02:00')).toBe(0b11000) // past midnight
    expect(openSlots('sunrise-sunset')).toBe(0b00110)
    expect(openSlots('Mo-Su 18:00+')).toBe(0b11000) // open end
    expect(openSlots('Mo-Fr 07:00-10:00, 12:00-14:00')).toBe(0b00110)
    expect(openSlots('off')).toBe(0)
    const at = hours => poiFeatures({ type: 'node', id: 1, lat: 51.5, lon: -0.1, tags: { name: 'C', amenity: 'cafe', ...(hours && { opening_hours: hours }) } }).flags
    expect(at(null) & (HAS_HOURS | OPEN_MASK)).toBe(0)
    expect(at('off') & (HAS_HOURS | OPEN_MASK)).toBe(HAS_HOURS) // known closed all day
    expect(at('24/7') & OPEN_MASK).toBe(OPEN_MASK)
  })
})

describe('rankCap', () => {
  // compact rows as the server reads them from ix_rank, from the real sample, spread over London
  const rowsOf = els => els.map((el, i) => {
    const lat = 51.35 + (i * 7919 % 400) / 1000
    const lon = -0.45 + (i * 104729 % 700) / 1000
    return { osm_type: 1, osm_id: i + 1, min_lat: lat, max_lat: lat, min_lon: lon, max_lon: lon, ...poiFeatures({ ...el, lat, lon, center: undefined }) }
  })
  const many = rowsOf(Array.from({ length: 8 }, () => SAMPLE).flat()) // ~5000 rows
  const LONDON = { lat: 51.5074, lng: -0.1278 }

  it('at or under the cap returns the very same array', () => {
    const few = many.slice(0, 100)
    expect(rankCap(few, LONDON, 100)).toBe(few)
  })

  it('over the cap: exactly cap rows, a subset in the original order, input untouched, deterministic', () => {
    const before = structuredClone(many)
    const out = rankCap(many, LONDON, 3000)
    expect(out).toHaveLength(3000)
    const pos = new Map(many.map((r, i) => [r, i]))
    const idx = out.map(r => pos.get(r))
    expect(idx.every((v, i) => v !== undefined && (i === 0 || v > idx[i - 1]))).toBe(true)
    expect(many).toEqual(before)
    expect(rankCap(structuredClone(many), LONDON, 3000).map(r => r.osm_id)).toEqual(out.map(r => r.osm_id))
  })

  it('never keeps a row the phone drops, and keeps the farthest eligible place of every category', () => {
    const rows = [...many, { osm_type: 1, osm_id: 1e9, min_lat: 51.5, max_lat: 51.5, min_lon: -0.12, max_lon: -0.12, q: 100, cat: 1, flags: SKIP }]
    const out = rankCap(rows, LONDON, 2000)
    expect(out.some(r => r.flags & SKIP)).toBe(false)
    const dist = r => Math.hypot(r.min_lat - LONDON.lat, (r.min_lon - LONDON.lng) * 0.62)
    for (let cat = 1; cat <= CATEGORY_KEYS.length; cat++) {
      const eligible = rows.filter(r => r.cat === cat && r.flags & ELIGIBLE && !(r.flags & SKIP))
      if (!eligible.length) continue
      const far = Math.max(...eligible.map(dist))
      expect(out.some(r => r.cat === cat && r.flags & ELIGIBLE && Math.abs(dist(r) - far) < 1e-3), CATEGORY_KEYS[cat - 1]).toBe(true)
    }
  })

  it('slack: the stratum floor holds for a phone ANYWHERE in the snap cell, not just at grid points', () => {
    const RINGS = [1, 2, 5, 10, 20, Infinity]
    const starved = (out, at) => {
      const count = list => {
        const m = new Map()
        for (const r of list.filter(r => !(r.flags & SKIP))) {
          const k = `${r.cat}|${RINGS.findIndex(x => haversineKm(at.lat, at.lng, r.min_lat, r.min_lon) <= x)}`
          m.set(k, (m.get(k) || 0) + 1)
        }
        return m
      }
      const full = count(many)
      const kept = count(out)
      return [...full].filter(([k, n]) => (kept.get(k) || 0) < Math.min(n, 25)).length
    }
    // dense enough that the cap binds and the floors decide (not "keep everything")
    const withSlack = rankCap(many, LONDON, 1500, 0.005)
    expect(withSlack).toHaveLength(1500)
    let seed = 11
    const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822519) + 12345 | 0) >>> 0) / 2 ** 32
    const points = [LONDON, ...Array.from({ length: 150 }, () => ({ lat: LONDON.lat - 0.005 + rnd() * 0.01, lng: LONDON.lng - 0.005 + rnd() * 0.01 })),
      // the cell's corners and edge midpoints, where rings shift most
      ...[-0.005, 0, 0.005].flatMap(a => [-0.005, 0, 0.005].map(b => ({ lat: LONDON.lat + a, lng: LONDON.lng + b })))]
    for (const at of points) expect(starved(withSlack, at), `${at.lat},${at.lng}`).toBe(0)
    // what the slack is for: ranked for the centre only, positions off it starve
    const without = rankCap(many, LONDON, 1500)
    expect(points.some(at => starved(without, at) > 0)).toBe(true)
  })

  it('a way is placed at the centre of its bounds: the same choice as nodes at those centres', () => {
    const asWays = many.map((r, i) => (i % 3 ? r : { ...r, osm_type: 2, min_lat: r.min_lat - 0.004, max_lat: r.max_lat + 0.004, min_lon: r.min_lon - 0.002, max_lon: r.max_lon + 0.002 }))
    const ids = rows => rankCap(rows, LONDON, 3000).map(r => r.osm_id)
    expect(ids(asWays)).toEqual(ids(many))
    // and it is the centre, not a corner: pushing every way's box north changes the choice
    const shifted = asWays.map(r => (r.osm_type === 2 ? { ...r, max_lat: r.max_lat + 0.2 } : r))
    expect(ids(shifted)).not.toEqual(ids(many))
  })
})

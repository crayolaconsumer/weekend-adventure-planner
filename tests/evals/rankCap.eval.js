// @vitest-environment node
/**
 * Relevance cap eval (rubric: /tmp/roam-overnight/ranking/RUBRIC.md, frozen).
 * Does the capped answer give the phone the SAME deck as the full one?
 *
 *   POI_FIXTURES=<dir of {center,bbox,rows}.json> [RANK_IMPL=<module>] \
 *     npx vitest run -c vitest.eval.config.js tests/evals/rankCap.eval.js
 *
 * Fixtures: too big to commit (London 30 km is 14 MB; the set is ~50 MB). Made by
 * scripts/poi/evalFixtures.mjs (public Overpass, shaped as the build shapes rows;
 * the London/Manchester/York ones of 2026-09-27 were read from the pois table).
 * The small committed slice tests/fixtures/rankGateLondon.json feeds the GATE
 * version of this check (tests/unit/poi/rankCapGate.test.js).
 * The deck is the app's own picker, configured as Discover.jsx:516.
 */
import { describe, it, expect, vi } from 'vitest'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseOverpassResponse } from '../../src/utils/apiClient.js'
import { filterPlaces, enhancePlace, calculateDistance } from '../../src/utils/placeFilter.js'
import { CAP as SERVER_CAP } from '../../shared/poiRank.mjs'

const DIR = process.env.POI_FIXTURES || '/tmp/roam-overnight/ranking/fixtures'
// Default: the production ranker (shared/poiRank.mjs) through its fixture adapter
const IMPL = resolve(process.env.RANK_IMPL || 'tests/evals/rankCapAdapter.mjs')
// The server's own cap (3,500 since round 4; the rubric's first figure was 3,000)
const CAP = SERVER_CAP
// Astra review: a single live clock and one seed made A/B runs uncontrolled.
// Every capped fixture is judged across this fixed sweep (Europe/London local
// times: weekday and weekend, open and closed hours) and three seeds.
const SWEEP_TIMES = ['2026-09-28T08:30:00', '2026-09-30T12:30:00', '2026-10-02T19:00:00', '2026-10-03T10:00:00', '2026-10-04T03:00:00', '2026-10-03T23:30:00']
const SEEDS = [12345, 1, 99]
const REQUIRED = ['london-5.json', 'london-15.json', 'london-30.json', 'manchester-15.json', 'york-5.json']
let SEED = SEEDS[0]
const RINGS = [1, 2, 5, 10, 20, Infinity]

const deck = (rows, center, categories = null, seen = null) => {
  let places = parseOverpassResponse({ elements: rows.map(r => JSON.parse(r.el)) }).map(p => enhancePlace(p, center))
  // seenPlaces.js excludeSeen: swiped places are taken out before the picker
  if (seen) places = places.filter(p => !seen.has(String(p.id)))
  return filterPlaces(places, { minScore: 25, maxResults: 100, sortBy: 'smart', ensureDiversity: true, seed: SEED, categories })
}
// The first 200 cards a user swipes on the full answer: two decks of 100, the second dealt without the first
const swiped200 = (rows, center) => {
  const seen = new Set(deck(rows, center).map(p => String(p.id)))
  for (const p of deck(rows, center, null, seen)) seen.add(String(p.id))
  return seen
}
const overlap = (a, b) => {
  const ids = new Set(b.map(p => `${p.id}`))
  // An empty reference deck proves nothing: fail rather than score 1
  if (!a.length) throw new Error('empty reference deck')
  return a.filter(p => ids.has(`${p.id}`)).length / a.length
}
const strata = (rows, center) => {
  const m = new Map()
  for (const p of parseOverpassResponse({ elements: rows.map(r => JSON.parse(r.el)) }).map(p => enhancePlace(p, center))) {
    const ring = RINGS.findIndex(r => calculateDistance(center.lat, center.lng, p.lat, p.lng) <= r)
    const key = `${p.category?.key || 'other'}|${ring}`
    m.set(key, (m.get(key) || 0) + 1)
  }
  return m
}
// Every phone in a snap cell gets the same body (bboxSnap.js): positions across that cell
const SNAP = 0.01
const cellGrid = (center, n) => {
  const c = { lat: Math.round(center.lat / SNAP) * SNAP, lng: Math.round(center.lng / SNAP) * SNAP }
  const out = []
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) out.push({ lat: c.lat - SNAP / 2 + (SNAP * a) / (n - 1), lng: c.lng - SNAP / 2 + (SNAP * b) / (n - 1) })
  return out
}
// FILTER SUPPLY at each position: starved (category x ring) strata, from parsed places
const starvedAt = (full, kept, u) => {
  const count = list => {
    const m = new Map()
    for (const p of list) {
      const key = `${p.catKey}|${RINGS.findIndex(r => calculateDistance(u.lat, u.lng, p.lat, p.lng) <= r)}`
      m.set(key, (m.get(key) || 0) + 1)
    }
    return m
  }
  const a = count(full)
  const b = count(kept)
  return [...a].filter(([k, n]) => (b.get(k) || 0) < Math.min(n, 25)).map(([k, n]) => `${k} ${b.get(k) || 0}/${n}`)
}
const parsedWithCat = rows => parseOverpassResponse({ elements: rows.map(r => JSON.parse(r.el)) })
  .map(p => ({ ...p, catKey: enhancePlace(p, { lat: p.lat, lng: p.lng }).category?.key || 'other' }))

const fixtures = existsSync(DIR) ? readdirSync(DIR).filter(f => f.endsWith('.json')).sort() : []

describe(`rankCap eval: ${IMPL}`, () => {
  it('has every named fixture', () => {
    expect(process.env.TZ).toBe('Europe/London')
    for (const f of REQUIRED) expect(fixtures, f).toContain(f)
  })

  const results = []
  for (const f of fixtures) {
    it(f, async () => {
      const { rankCap } = await import(IMPL)
      const { center, rows } = JSON.parse(readFileSync(join(DIR, f), 'utf8'))
      // The ranker gets its own copy, so it can't touch the reference's input
      const input = structuredClone(rows)
      const t = performance.now()
      const capped = rankCap(input, center, CAP)
      const ms = Math.round(performance.now() - t)
      const r = { fixture: f, rows: rows.length, capped: capped.length, rank_ms: ms }
      if (rows.length <= CAP) {
        // 1. PARITY
        expect(capped).toEqual(rows)
      } else {
        // 2. CAP, same rows as the DB gave (subset), original order kept
        expect(capped.length).toBeLessThanOrEqual(CAP)
        const pos = new Map(rows.map((x, i) => [`${x.osm_type}/${x.osm_id}`, i]))
        const idx = capped.map(x => pos.get(`${x.osm_type}/${x.osm_id}`))
        expect(idx.every(i => i !== undefined)).toBe(true)
        expect(idx.every((v, i) => i === 0 || v > idx[i - 1])).toBe(true)
        // 7. DETERMINISM
        expect(rankCap(rows, center, CAP)).toEqual(capped)
        // 3. DECK OVERLAP
        // min over the time x seed sweep, per category run
        r.overlap = {}
        r.worst = {}
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
          for (const at of SWEEP_TIMES) {
            vi.setSystemTime(new Date(at))
            for (const seed of SEEDS) {
              SEED = seed
              for (const cats of [null, ['food'], ['culture'], ['nature']]) {
                const key = cats ? cats[0] : 'all'
                const ref = deck(rows, center, cats)
                // The full answer has no places of this category at all (the 5 km all-category
                // query asks for no museums: the phone sends its own query when that filter is
                // picked), so no ranker could be judged on it. Recorded, not scored. The
                // unfiltered deck must never be empty (overlap throws).
                if (cats && !ref.length) { r.not_applicable = [...new Set([...(r.not_applicable || []), key])]; continue }
                const v = Math.round(overlap(ref, deck(capped, center, cats)) * 1000) / 1000
                if (!(key in r.overlap) || v < r.overlap[key]) { r.overlap[key] = v; r.worst[key] = `${at} seed ${seed}` }
              }
              // Freshness: the user has swiped the first 200 cards. The capped body is shared and
              // cached, so it can't know that; how close is the deck they get next? Reported, not
              // gated (the frozen rubric predates freshness)
              const seen = swiped200(rows, center)
              const sv = Math.round(overlap(deck(rows, center, null, seen), deck(capped, center, null, seen)) * 1000) / 1000
              if (r.swiped200 === undefined || sv < r.swiped200) r.swiped200 = sv
            }
          }
        } finally {
          vi.useRealTimers()
          SEED = SEEDS[0]
        }
        r.bytes = capped.reduce((n, x) => n + Buffer.byteLength(x.el) + 1, 0)
        // 4. FILTER SUPPLY
        const full = strata(rows, center)
        const kept = strata(capped, center)
        r.starved = [...full].filter(([k, n]) => (kept.get(k) || 0) < Math.min(n, 25)).map(([k, n]) => `${k} ${kept.get(k) || 0}/${n}`)
        // Astra round 1 item 3: the same guarantees for every phone sharing the body. Supply on
        // an 11 x 11 grid over the snap cell (gated); decks on a 3 x 3 grid (gated like the rest)
        const fullP = parsedWithCat(rows)
        const keptP = parsedWithCat(capped)
        r.grid_starved = cellGrid(center, 11).flatMap(u => starvedAt(fullP, keptP, u).map(x => `${u.lat.toFixed(4)},${u.lng.toFixed(4)} ${x}`))
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
          vi.setSystemTime(new Date('2026-10-03T10:00:00'))
          SEED = 12345
          r.grid_overlap = {}
          for (const u of cellGrid(center, 3)) {
            for (const cats of [null, ['food']]) {
              const key = cats ? cats[0] : 'all'
              const v = Math.round(overlap(deck(rows, u, cats), deck(capped, u, cats)) * 1000) / 1000
              if (!(key in r.grid_overlap) || v < r.grid_overlap[key]) r.grid_overlap[key] = v
            }
          }
        } finally {
          vi.useRealTimers()
        }
      }
      results.push(r)
      console.log(JSON.stringify(r))
      writeFileSync(join(DIR, '..', `eval-${IMPL.split('/').slice(-2).join('_')}.jsonl`), results.map(x => JSON.stringify(x)).join('\n') + '\n')
      if (r.overlap) {
        // The rubric's category runs are at London 15 km: they must all be scored there
        if (f === 'london-15.json') expect(Object.keys(r.overlap).sort()).toEqual(['all', 'culture', 'food', 'nature'])
        for (const v of Object.values(r.overlap)) expect(v).toBeGreaterThanOrEqual(0.9)
        expect(r.starved).toEqual([])
        expect(r.grid_starved).toEqual([])
        for (const v of Object.values(r.grid_overlap)) expect(v).toBeGreaterThanOrEqual(0.9)
        expect(r.bytes).toBeLessThanOrEqual(1_500_000)
      }
    })
  }
})

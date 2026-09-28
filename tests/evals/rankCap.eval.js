// @vitest-environment node
/**
 * Relevance cap eval (rubric: /tmp/roam-overnight/ranking/RUBRIC.md, frozen).
 * Does the capped answer give the phone the SAME deck as the full one?
 *
 *   POI_FIXTURES=<dir of {center,bbox,rows}.json> [RANK_IMPL=<module>] \
 *     npx vitest run -c vitest.eval.config.js tests/evals/rankCap.eval.js
 *
 * Fixtures are real DB answers (scripts/poi/shadow-check.mjs style dumps).
 * The deck is the app's own picker, configured as Discover.jsx:489.
 */
import { describe, it, expect, vi } from 'vitest'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseOverpassResponse } from '../../src/utils/apiClient.js'
import { filterPlaces, enhancePlace, calculateDistance } from '../../src/utils/placeFilter.js'

const DIR = process.env.POI_FIXTURES || '/tmp/roam-overnight/ranking/fixtures'
// Default: the production ranker (shared/poiRank.mjs) through its fixture adapter
const IMPL = resolve(process.env.RANK_IMPL || 'tests/evals/rankCapAdapter.mjs')
const CAP = 3000
// Astra review: a single live clock and one seed made A/B runs uncontrolled.
// Every capped fixture is judged across this fixed sweep (Europe/London local
// times: weekday and weekend, open and closed hours) and three seeds.
const SWEEP_TIMES = ['2026-09-28T08:30:00', '2026-09-30T12:30:00', '2026-10-02T19:00:00', '2026-10-03T10:00:00', '2026-10-04T03:00:00', '2026-10-03T23:30:00']
const SEEDS = [12345, 1, 99]
const REQUIRED = ['london-5.json', 'london-15.json', 'london-30.json', 'manchester-15.json', 'york-5.json']
let SEED = SEEDS[0]
const RINGS = [1, 2, 5, 10, 20, Infinity]

const deck = (rows, center, categories = null) => {
  const places = parseOverpassResponse({ elements: rows.map(r => JSON.parse(r.el)) }).map(p => enhancePlace(p, center))
  return filterPlaces(places, { minScore: 25, maxResults: 100, sortBy: 'smart', ensureDiversity: true, seed: SEED, categories })
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
      }
      results.push(r)
      console.log(JSON.stringify(r))
      writeFileSync(join(DIR, '..', `eval-${IMPL.split('/').slice(-2).join('_')}.jsonl`), results.map(x => JSON.stringify(x)).join('\n') + '\n')
      if (r.overlap) {
        // The rubric's category runs are at London 15 km: they must all be scored there
        if (f === 'london-15.json') expect(Object.keys(r.overlap).sort()).toEqual(['all', 'culture', 'food', 'nature'])
        for (const v of Object.values(r.overlap)) expect(v).toBeGreaterThanOrEqual(0.9)
        expect(r.starved).toEqual([])
        expect(r.bytes).toBeLessThanOrEqual(1_500_000)
      }
    })
  }
})

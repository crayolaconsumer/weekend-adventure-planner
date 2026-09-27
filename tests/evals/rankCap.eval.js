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
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseOverpassResponse } from '../../src/utils/apiClient.js'
import { filterPlaces, enhancePlace, calculateDistance } from '../../src/utils/placeFilter.js'

const DIR = process.env.POI_FIXTURES || '/tmp/roam-overnight/ranking/fixtures'
const IMPL = resolve(process.env.RANK_IMPL || 'api/lib/poiRank.js')
const CAP = 3000
const SEED = 12345
const RINGS = [1, 2, 5, 10, 20, Infinity]

const deck = (rows, center, categories = null) => {
  const places = parseOverpassResponse({ elements: rows.map(r => JSON.parse(r.el)) }).map(p => enhancePlace(p, center))
  return filterPlaces(places, { minScore: 25, maxResults: 100, sortBy: 'smart', ensureDiversity: true, seed: SEED, categories })
}
const overlap = (a, b) => {
  const ids = new Set(b.map(p => `${p.id}`))
  return a.length ? a.filter(p => ids.has(`${p.id}`)).length / a.length : 1
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
  it('has fixtures', () => expect(fixtures.length).toBeGreaterThan(0))

  const results = []
  for (const f of fixtures) {
    it(f, async () => {
      const { rankCap } = await import(IMPL)
      const { center, rows } = JSON.parse(readFileSync(join(DIR, f), 'utf8'))
      const t = performance.now()
      const capped = rankCap(rows, center, CAP)
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
        r.overlap = {}
        for (const cats of [null, ['food'], ['culture'], ['nature']]) {
          const key = cats ? cats[0] : 'all'
          r.overlap[key] = Math.round(overlap(deck(rows, center, cats), deck(capped, center, cats)) * 1000) / 1000
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
        for (const v of Object.values(r.overlap)) expect(v).toBeGreaterThanOrEqual(0.9)
        expect(r.starved).toEqual([])
        expect(r.bytes).toBeLessThanOrEqual(1_500_000)
      }
    })
  }
})

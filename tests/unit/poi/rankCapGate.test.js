// @vitest-environment node
/**
 * GATE for the relevance cap (the full eval, tests/evals/rankCap.eval.js, is
 * periodic and needs /tmp fixtures). A committed 2,375-place slice of the
 * London 15 km answer, capped to 450 by shared/poiRank.mjs as the server does,
 * must deal nearly the same deck as the uncapped slice (min over 3 times x 2
 * seeds x 3 category runs, 50-card decks). The floor sits between what the
 * ranker scores (0.96, measured 2026-09-28) and what the obvious shortcuts
 * score: keeping the 450 best by q (0.54), or the first 450 rows. So replacing
 * the rank step fails CI. (450, not less: the stratum floors, sized for a
 * 3,000-row cap, take a fixed ~450 slots here; at 300 the fill had almost none
 * and the ranker scored only 0.66.)
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { parseOverpassResponse } from '../../../src/utils/apiClient.js'
import { filterPlaces, enhancePlace } from '../../../src/utils/placeFilter.js'
import { rankCap, capWith } from '../../evals/rankCapAdapter.mjs'

const { center, elements } = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'rankGateLondon.json'), 'utf8'))
const rows = elements.map(el => ({ osm_type: { node: 1, way: 2, relation: 3 }[el.type], osm_id: el.id, el: JSON.stringify(el) }))
const CAP = 450
const FLOOR = 0.85
const TZ = process.env.TZ

// The deck reads the local clock (time of day, open now): fix both, whatever the machine
beforeAll(() => { process.env.TZ = 'Europe/London'; vi.useFakeTimers({ toFake: ['Date'] }) })
afterAll(() => { vi.useRealTimers(); process.env.TZ = TZ })

const places = list => parseOverpassResponse({ elements: list.map(r => JSON.parse(r.el)) }).map(p => enhancePlace(p, center))
function minOverlap(capped) {
  const full = places(rows)
  const kept = places(capped)
  let min = 1
  for (const at of ['2026-09-28T08:30:00', '2026-10-02T19:00:00', '2026-10-04T03:00:00']) {
    vi.setSystemTime(new Date(at))
    for (const seed of [1, 99]) {
      for (const categories of [null, ['food'], ['nature']]) {
        const deck = list => filterPlaces(list, { minScore: 25, maxResults: 50, sortBy: 'smart', ensureDiversity: true, seed, categories })
        const ref = deck(full)
        const ids = new Set(deck(kept).map(p => p.id))
        expect(ref.length).toBeGreaterThan(0)
        min = Math.min(min, ref.filter(p => ids.has(p.id)).length / ref.length)
      }
    }
  }
  return min
}

describe('rank-cap gate: the capped answer deals the uncapped deck', () => {
  it(`the server ranker keeps deck overlap >= ${FLOOR}`, () => {
    expect(rows.length).toBe(2375)
    const capped = rankCap(rows, center, CAP)
    expect(capped).toHaveLength(CAP)
    expect(minOverlap(capped)).toBeGreaterThanOrEqual(FLOOR)
  })

  it('and the floor has teeth: a plain sort by q, or the first rows, falls below it', () => {
    const byQ = capWith(rows, center, CAP, list => [...list].sort((a, b) => b.q - a.q).slice(0, CAP))
    expect(byQ).toHaveLength(CAP)
    expect(minOverlap(byQ)).toBeLessThan(FLOOR)
    expect(minOverlap(rows.slice(0, CAP))).toBeLessThan(FLOOR)
  })
})

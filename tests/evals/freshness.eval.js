/**
 * Discover deck freshness eval (rubric: /tmp/roam-overnight/freshness/RUBRIC.md, frozen).
 *
 *   npx vitest run -c vitest.eval.config.js tests/evals/freshness.eval.js
 *
 * 10 sessions x 40 swipes in York, 5 km, on the real DB fixture. Each session
 * is a reload (the seen store is re-read from localStorage) and deals the deck
 * the app deals: buildFreshDeck over applyDiscoverFilters (Discover.jsx).
 * Reports repeats (a fresh card the user already swiped: must be 0), recycled
 * cards (oldest skips, last resort; never one skipped that day) and the first
 * session whose deck is short of new places (runs dry).
 *
 * Scenarios: all 5 km (no distance band), and the app default walking band
 * (1.5 km to 3 km); sessions all on one day, and one a day. Old skips are
 * recycled only in the scenario with no wider radius or filter on offer,
 * as Discover.jsx decides (canRecycle). Closed places are
 * included so the result doesn't depend on the clock. Baseline: the same run
 * without exclusion (the old behaviour) must show the repeats this fixes.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import process from 'node:process'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { parseOverpassResponse } from '../../src/utils/apiClient.js'
import { enhancePlace } from '../../src/utils/placeFilter.js'
import { applyDiscoverFilters } from '../../src/pages/Discover/applyFilters'
import { buildFreshDeck, recordSeen, resetSeenCache, FULL_DECK } from '../../src/utils/seenPlaces.js'

const FIXTURE = process.env.FRESHNESS_FIXTURE || '/tmp/roam-overnight/ranking/fixtures/york-5.json'
const OUT = '/tmp/roam-overnight/freshness/eval-results.json'
const SESSIONS = 10
const SWIPES = 40
const DAY = 86400000
const T0 = new Date('2026-09-28T12:00:00').getTime()

let pool
beforeAll(() => {
  const { center, rows } = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  pool = parseOverpassResponse({ elements: rows.map(r => JSON.parse(r.el)) }).map(p => enhancePlace(p, center))
})

const pickFor = band => list => applyDiscoverFilters(list, {
  selectedCategories: [], showFreeOnly: false, accessibilityMode: false, showLocalsPicks: false, showOffPeak: false,
  isPremium: false, userProfile: null, weather: null, friendActivity: null, includeClosed: true,
  ...(band ? { travelMode: 'walking', selectedBand: band } : {}),
})

function simulate({ band, daily, recycle = false, exclude = true, sessions: count = SESSIONS }) {
  localStorage.clear()
  resetSeenCache()
  const pick = pickFor(band)
  const swipedOn = new Map() // id -> day index of last swipe
  const sessions = []
  for (let s = 0; s < count; s++) {
    resetSeenCache() // reload
    const now = T0 + (daily ? s : 0) * DAY + s * 60000
    const day = daily ? s : 0
    const built = exclude ? buildFreshDeck(pool, pick, { now, recycle }) : { places: pick(pool), fresh: null, recycled: 0, dry: false }
    const deck = built.places
    const freshIds = new Set(deck.slice(0, built.fresh ?? deck.length).map(p => p.id))
    let repeats = 0
    let recycledSwiped = 0
    let recycledToday = 0
    const dealt = deck.slice(0, SWIPES)
    dealt.forEach((p, i) => {
      if (swipedOn.has(p.id)) {
        if (freshIds.has(p.id)) repeats++
        else {
          recycledSwiped++
          if (swipedOn.get(p.id) === day) recycledToday++
        }
      }
      // Every 5th card saved, the rest skipped
      const action = i % 5 === 4 ? 'like' : 'skip'
      if (exclude) recordSeen(p.id, action, now + i * 1000)
      swipedOn.set(p.id, day)
    })
    sessions.push({
      session: s + 1, deck: deck.length, fresh: built.fresh ?? deck.length, swiped: dealt.length,
      repeats, recycled: built.recycled, recycledSwiped, recycledToday, dry: built.dry, first: deck[0]?.name ?? null,
    })
  }
  const dryAt = sessions.find(x => x.dry)?.session ?? null
  const emptyAt = sessions.find(x => x.deck === 0)?.session ?? null
  return {
    sessions, dryAt, emptyAt,
    repeats: sessions.reduce((a, x) => a + x.repeats, 0),
    recycledToday: sessions.reduce((a, x) => a + x.recycledToday, 0),
    distinctFirstCards: new Set(sessions.map(x => x.first).filter(Boolean)).size,
  }
}

const SCENARIOS = [
  { name: '5km-same-day', band: null, daily: false },
  { name: '5km-daily', band: null, daily: true },
  { name: 'walking-medium-same-day', band: 'medium', daily: false },
  { name: 'walking-medium-daily', band: 'medium', daily: true },
  // As if nothing wider were on offer (e.g. free user, driving, furthest
  // band, no filters): the only case where old skips come back
  { name: 'walking-medium-daily-no-wider-option', band: 'medium', daily: true, recycle: true },
]

describe('freshness eval: York 5 km, 10 sessions x 40 swipes', () => {
  const results = {}

  it('has the fixture', () => {
    expect(existsSync(FIXTURE)).toBe(true)
    expect(pool.length).toBeGreaterThan(500)
  })

  for (const sc of SCENARIOS) {
    it(sc.name, () => {
      const r = simulate(sc)
      results[sc.name] = r
      console.log(`\n${sc.name}: repeats=${r.repeats} dryAt=${r.dryAt} emptyAt=${r.emptyAt} distinctFirstCards=${r.distinctFirstCards}/${SESSIONS}`)
      console.table(r.sessions)
      expect(r.repeats).toBe(0)
      expect(r.recycledToday).toBe(0)
      // Fresh: first card differs every reload while new places remain
      const withNew = r.sessions.filter(x => x.fresh > 0)
      expect(new Set(withNew.map(x => x.first)).size).toBe(withNew.length)
      // Full decks until the pool actually runs short
      for (const x of r.sessions) if (!x.dry) expect(x.deck).toBe(FULL_DECK)
    })
  }

  it('baseline (no exclusion, the old deck) repeats: proves the eval can fail', () => {
    const r = simulate({ band: null, daily: false, exclude: false })
    results.baseline = r
    console.log(`\nbaseline (old behaviour): repeats=${r.repeats} of ${SESSIONS * SWIPES} swipes, distinctFirstCards=${r.distinctFirstCards}/${SESSIONS}`)
    expect(r.repeats).toBeGreaterThan(0)
  })

  it('5 km keeps going: the session where the whole 5 km pool runs dry', () => {
    const r = simulate({ band: null, daily: false, sessions: 40 })
    results['5km-until-dry'] = { dryAt: r.dryAt, emptyAt: r.emptyAt, repeats: r.repeats, sessions: r.sessions }
    console.log(`\n5km-until-dry: dryAt=${r.dryAt} emptyAt=${r.emptyAt} repeats=${r.repeats}`)
    expect(r.repeats).toBe(0)
    expect(r.dryAt).not.toBeNull()
  })

  // Rubric 2: < 5 ms added to a deck build with 5,000 remembered ids (median of
  // 15 runs on a 3,000-place pool, the parse done once as on app start)
  it('5,000 remembered ids add < 5 ms to a deck build', () => {
    resetSeenCache()
    const t0 = Date.now()
    for (let i = 0; i < 5000; i++) recordSeen(`p${i}`, i % 5 ? 'skip' : 'like', t0)
    const pool = Array.from({ length: 3000 }, (_, i) => ({ id: `q${i}` }))
    const pick = list => list.slice(0, FULL_DECK)
    buildFreshDeck(pool, pick, { now: t0 })
    const runs = []
    for (let r = 0; r < 15; r++) {
      const t = performance.now()
      buildFreshDeck(pool, pick, { now: t0 })
      runs.push(performance.now() - t)
    }
    runs.sort((a, b) => a - b)
    results.perf_median_ms = Math.round(runs[7] * 100) / 100
    expect(runs[7]).toBeLessThan(5)
  })

  it('writes results', () => {
    mkdirSync('/tmp/roam-overnight/freshness', { recursive: true })
    writeFileSync(OUT, JSON.stringify(results, null, 2))
  })
})

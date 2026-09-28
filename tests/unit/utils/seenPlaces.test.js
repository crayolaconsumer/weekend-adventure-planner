/**
 * Discover deck freshness (rubric /tmp/roam-overnight/freshness/RUBRIC.md).
 * The seen store + deck build: points 1, 2, 5, 6, 7.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  STORAGE_KEY, SKIP_DAYS, MAX_SEEN, FULL_DECK, RECYCLE_FLOOR,
  recordSeen, mergeSeen, excludeSeen, buildFreshDeck, resetSeenCache, seenCount, dayOf, setSeenOwner,
} from '../../../src/utils/seenPlaces'
import { applyDiscoverFilters } from '../../../src/pages/Discover/applyFilters'

const DAY = 86400000
const NOW = new Date('2026-09-28T12:00:00').getTime()
const places = n => Array.from({ length: n }, (_, i) => ({ id: 1000 + i, score: n - i }))
// Stand-in picker: keeps order, caps at the deck size, like applyDiscoverFilters
const pick = list => list.slice(0, FULL_DECK)
const ids = list => list.map(p => p.id)
const reload = () => resetSeenCache({ keepOwner: true }) // a new page load reads storage afresh

beforeEach(() => { localStorage.clear(); resetSeenCache() })
afterEach(() => vi.restoreAllMocks())

describe('1. no repeats across reloads', () => {
  it('a swiped place (skip or like) is not dealt again after a reload', () => {
    const all = places(200)
    const first = buildFreshDeck(all, pick, { now: NOW }).places
    first.slice(0, 30).forEach((p, i) => recordSeen(p.id, i % 3 ? 'skip' : 'like', NOW))
    reload()
    const next = buildFreshDeck(all, pick, { now: NOW + 1000 }).places
    expect(next.filter(p => ids(first.slice(0, 30)).includes(p.id))).toEqual([])
    expect(next).toHaveLength(FULL_DECK)
  })

  it('a skip stays out for 60 days, then may return; a like never does', () => {
    recordSeen(1, 'skip', NOW)
    recordSeen(2, 'like', NOW)
    reload()
    const list = [{ id: 1 }, { id: 2 }, { id: 3 }]
    expect(ids(excludeSeen(list, NOW + (SKIP_DAYS - 1) * DAY))).toEqual([3])
    expect(ids(excludeSeen(list, NOW + SKIP_DAYS * DAY))).toEqual([1, 3])
    expect(ids(excludeSeen(list, NOW + 3650 * DAY))).toEqual([1, 3])
  })

  it('matches ids whatever their type (server sends strings, OSM numbers)', () => {
    mergeSeen([{ placeId: '42', swipedAt: NOW, action: 'skip' }])
    expect(excludeSeen([{ id: 42 }, { id: 43 }], NOW).map(p => p.id)).toEqual([43])
  })
})

describe('2. scale of memory', () => {
  const fill = n => {
    // 10-12 digit ids like real OSM ids, spread over 120 days
    // One bulk merge (a single save): recordSeen re-reads storage per write for
    // two-tab safety, so 5,000 of them in a row is O(n^2) and timed out under load
    mergeSeen(Array.from({ length: n }, (_, i) => ({ placeId: 12000000000 + i * 7919, action: i % 4 ? 'skip' : 'like', swipedAt: NOW - (120 - Math.floor(i / (n / 120))) * DAY })))
  }

  it(`remembers ${MAX_SEEN} places in under 150 KB`, () => {
    fill(MAX_SEEN)
    reload()
    expect(seenCount()).toBe(MAX_SEEN)
    const raw = localStorage.getItem(`${STORAGE_KEY}:anon`)
    // Even counted as UTF-16 (2 bytes a char, how browsers bill localStorage)
    expect(raw.length * 2).toBeLessThan(150 * 1024)
  })

  it('past the cap evicts the oldest skips first, keeping older likes', () => {
    fill(MAX_SEEN)
    recordSeen('newest', 'skip', NOW)
    reload()
    expect(seenCount()).toBe(MAX_SEEN)
    expect(excludeSeen([{ id: 'newest' }], NOW)).toEqual([])
    // i=0 is the oldest place and a like: kept. i=1, the oldest skip: evicted
    expect(excludeSeen([{ id: 12000000000 }], NOW)).toEqual([])
    expect(excludeSeen([{ id: 12000000000 + 7919 }], NOW)).toHaveLength(1)
  })

  it('only likes past the cap: the oldest like goes', () => {
    mergeSeen(Array.from({ length: MAX_SEEN + 1 }, (_, i) => ({ placeId: `L${i}`, action: 'like', swipedAt: NOW - (MAX_SEEN - i) * 1000 * 60 })))
    recordSeen('L-older', 'like', NOW - 30 * DAY)
    reload()
    expect(seenCount()).toBe(MAX_SEEN)
    expect(excludeSeen([{ id: 'L-older' }, { id: `L${MAX_SEEN}` }], NOW).map(p => p.id)).toEqual(['L-older'])
  })

  // Gate test: a loose wall-clock budget that only catches algorithmic
  // regressions (it flaked at 5 ms under a busy full-suite run). The rubric's
  // 5 ms figure is measured in tests/evals/freshness.eval.js.
  it('stays linear: a deck build with 5,000 seen ids is well under 25 ms', () => {
    fill(MAX_SEEN)
    reload()
    excludeSeen([{ id: 1 }], NOW) // parse once, as the first deck build does
    const list = places(3000)
    const runs = []
    for (let r = 0; r < 15; r++) {
      const t = performance.now()
      excludeSeen(list, NOW)
      runs.push(performance.now() - t)
    }
    runs.sort((a, b) => a - b)
    expect(runs[7]).toBeLessThan(25)
    // first read on app start (parse 5,000 from storage) is cheap too
    reload()
    const t = performance.now()
    excludeSeen(list, NOW)
    expect(performance.now() - t).toBeLessThan(20)
  })
})

describe('5. running dry', () => {
  it('flags dry only when seen places were held back and the deck is short', () => {
    expect(buildFreshDeck(places(20), pick, { now: NOW })).toMatchObject({ dry: false, fresh: 20 })
    recordSeen(1000, 'skip', NOW)
    expect(buildFreshDeck(places(20), pick, { now: NOW })).toMatchObject({ dry: true, fresh: 19, recycled: 0 })
    expect(buildFreshDeck(places(200), pick, { now: NOW })).toMatchObject({ dry: false, fresh: FULL_DECK })
  })

  it('not dry when the deck is small for another reason (filter, small area), even after swipes', () => {
    // 5 museums in range, the user swiped a cafe: the deck is short because
    // of the filter, not because of swipes, so it must not say "swiped the rest"
    const area = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, cat: 'museum' })),
      ...Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, cat: 'cafe' })),
    ]
    const museums = list => list.filter(p => p.cat === 'museum')
    recordSeen('c0', 'skip', NOW)
    expect(buildFreshDeck(area, museums, { now: NOW })).toMatchObject({ fresh: 5, dry: false })
    // Swipe one museum: now swiping IS why the deck is short
    recordSeen('m0', 'skip', NOW)
    expect(buildFreshDeck(area, museums, { now: NOW })).toMatchObject({ fresh: 4, dry: true })
  })

  it('never recycles while a wider radius or clearing filters is on offer (recycle: false)', () => {
    const all = places(8)
    all.slice(0, 6).forEach(p => recordSeen(p.id, 'skip', NOW - 10 * DAY))
    expect(buildFreshDeck(all, pick, { now: NOW })).toMatchObject({ fresh: 2, recycled: 0, dry: true })
    expect(buildFreshDeck(all, pick, { now: NOW, recycle: true })).toMatchObject({ fresh: 2, recycled: 6 })
  })

  it('last resort: tops up with the OLDEST skips, never one skipped today, never a like', () => {
    const all = places(8)
    recordSeen(1000, 'skip', NOW - 10 * DAY)
    recordSeen(1001, 'skip', NOW - 30 * DAY)
    recordSeen(1002, 'skip', NOW) // today
    recordSeen(1003, 'like', NOW - 40 * DAY)
    recordSeen(1004, 'skip', NOW - 20 * DAY)
    recordSeen(1005, 'skip', NOW - 1 * DAY)
    const deck = buildFreshDeck(all, pick, { now: NOW, recycle: true })
    expect(deck.fresh).toBe(2) // 1006, 1007
    expect(ids(deck.places)).toEqual([1006, 1007, 1001, 1004, 1000, 1005])
    expect(deck.recycled).toBe(4)
    expect(deck.dry).toBe(true)
  })

  it('recycles only up to the floor, and not at all while enough new places remain', () => {
    const all = places(RECYCLE_FLOOR + 30)
    all.slice(0, 30).forEach(p => recordSeen(p.id, 'skip', NOW - 5 * DAY))
    const deck = buildFreshDeck(all, pick, { now: NOW, recycle: true })
    expect(deck).toMatchObject({ fresh: RECYCLE_FLOOR, recycled: 0, dry: true })
    all.slice(30, 35).forEach(p => recordSeen(p.id, 'skip', NOW - 5 * DAY))
    expect(buildFreshDeck(all, pick, { now: NOW, recycle: true })).toMatchObject({ fresh: RECYCLE_FLOOR - 5, recycled: 5 })
    expect(buildFreshDeck(all, pick, { now: NOW, recycle: true }).places).toHaveLength(RECYCLE_FLOOR)
  })

  it('a pool swiped entirely today gives an empty, dry deck', () => {
    const all = places(5)
    all.forEach(p => recordSeen(p.id, 'skip', NOW))
    expect(buildFreshDeck(all, pick, { now: NOW, recycle: true })).toMatchObject({ places: [], fresh: 0, recycled: 0, dry: true })
  })
})

describe('6. fresh but quality-ranked', () => {
  // Real picker, a spread of genuinely different places
  const TYPES = ['museum', 'park', 'castle', 'viewpoint', 'gallery', 'pub', 'cafe', 'restaurant', 'garden', 'monument']
  const real = Array.from({ length: 150 }, (_, i) => ({
    id: 5000 + i, name: `Place ${i}`, type: TYPES[i % TYPES.length], lat: 53.96 + i * 1e-4, lng: -1.08,
    distance: 0.2 + (i % 40) * 0.1, wikipedia: i % 3 === 0 ? 'en:x' : undefined, website: 'https://x',
  }))
  const realPick = list => applyDiscoverFilters(list, {
    selectedCategories: [], showFreeOnly: false, accessibilityMode: false, showLocalsPicks: false,
    showOffPeak: false, isPremium: false, userProfile: null, weather: null, friendActivity: null, includeClosed: true,
  })

  it('with nothing seen, the deck is exactly the picker\'s deck (ranking untouched)', () => {
    expect(ids(buildFreshDeck(real, realPick, { now: NOW }).places)).toEqual(ids(realPick(real)))
  })

  it('the next reload shows a different first card, and the unswiped top cards stay on top', () => {
    const d1 = buildFreshDeck(real, realPick, { now: NOW }).places
    expect(d1.length).toBeGreaterThan(20)
    d1.slice(0, 5).forEach(p => recordSeen(p.id, 'skip', NOW))
    reload()
    const d2 = buildFreshDeck(real, realPick, { now: NOW }).places
    expect(d2[0].id).not.toBe(d1[0].id)
    const top2 = new Set(ids(d2.slice(0, 20)))
    const kept = d1.slice(5, 20).filter(p => top2.has(p.id)).length
    expect(kept / 15).toBeGreaterThanOrEqual(0.8)
  })
})

describe('7. safe with bad storage', () => {
  it('corrupt stored value: ignored, deck builds, next write repairs it', () => {
    localStorage.setItem(`${STORAGE_KEY}:anon`, '{"not":"ours"}\n\u0000garbage\nsZZZZ\nq1 5')
    reload()
    expect(buildFreshDeck(places(5), pick, { now: NOW }).places).toHaveLength(5)
    recordSeen(1000, 'skip', NOW)
    reload()
    expect(ids(excludeSeen(places(3), NOW))).toEqual([1001, 1002])
  })

  it('storage that throws on read and write (private mode, quota): no throw, remembered this session', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    reload()
    expect(() => recordSeen(1000, 'skip', NOW)).not.toThrow()
    expect(() => mergeSeen([{ placeId: 1001, swipedAt: NOW, action: 'like' }])).not.toThrow()
    expect(ids(buildFreshDeck(places(4), pick, { now: NOW }).places)).toEqual([1002, 1003])
  })

  it('merge ignores junk and keeps the newer record of a place', () => {
    recordSeen(7, 'like', NOW)
    const added = mergeSeen([null, {}, { placeId: 7, swipedAt: NOW - 90 * DAY, action: 'skip' }, { placeId: 8, swipedAt: 'x', action: 'skip' }])
    expect(added).toBe(1)
    reload()
    // 7 is still a like (the old server skip did not overwrite it): never returns
    expect(ids(excludeSeen([{ id: 7 }, { id: 8 }], NOW + 400 * DAY))).toEqual([8])
  })

  it('dayOf is the local calendar day', () => {
    expect(dayOf(new Date('2026-09-28T00:01:00').getTime())).toBe(dayOf(new Date('2026-09-28T23:59:00').getTime()))
    expect(dayOf(new Date('2026-09-29T00:01:00').getTime()) - dayOf(new Date('2026-09-28T23:59:00').getTime())).toBe(1)
  })
})

describe('one store per user, two tabs', () => {
  it("user B does not inherit user A's swipes; anonymous swipes merge into whoever signs in", () => {
    recordSeen('anon-1', 'skip', NOW)
    setSeenOwner(1)
    recordSeen('a-1', 'like', NOW)
    expect(ids(excludeSeen([{ id: 'anon-1' }, { id: 'a-1' }, { id: 'x' }], NOW))).toEqual(['x'])
    setSeenOwner(null) // A signs out: the anonymous store was emptied on sign-in
    expect(ids(excludeSeen([{ id: 'anon-1' }, { id: 'a-1' }], NOW))).toEqual(['anon-1', 'a-1'])
    setSeenOwner(2)
    expect(ids(excludeSeen([{ id: 'anon-1' }, { id: 'a-1' }], NOW))).toEqual(['anon-1', 'a-1'])
    setSeenOwner(1) // A again, on the same device
    reload()
    expect(excludeSeen([{ id: 'anon-1' }, { id: 'a-1' }], NOW)).toEqual([])
  })

  it("two tabs: a write keeps the other tab's swipes (union, newest day wins)", () => {
    recordSeen('tab1-a', 'skip', NOW - 3 * DAY) // tab 1 has read storage
    // tab 2 writes behind tab 1's back (simulate: fresh cache, write, restore)
    const tab1 = localStorage.getItem(`${STORAGE_KEY}:anon`)
    reload()
    recordSeen('tab2-b', 'skip', NOW)
    recordSeen('tab1-a', 'like', NOW) // tab 2 liked it later
    const tab2 = localStorage.getItem(`${STORAGE_KEY}:anon`)
    localStorage.setItem(`${STORAGE_KEY}:anon`, tab1)
    reload()
    excludeSeen([{ id: 1 }], NOW) // tab 1 cache = its own view
    localStorage.setItem(`${STORAGE_KEY}:anon`, tab2)
    recordSeen('tab1-c', 'skip', NOW) // tab 1 writes
    reload()
    expect(excludeSeen(['tab1-a', 'tab2-b', 'tab1-c', 'z'].map(id => ({ id })), NOW).map(p => p.id)).toEqual(['z'])
    // tab1-a is a like now (tab 2's newer record won): never returns
    expect(excludeSeen([{ id: 'tab1-a' }], NOW + 400 * DAY)).toEqual([])
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  FURTHER_MAX, READY_EVERY, SNOOZE_DAYS, SNOOZE_KEY,
  readSnoozes, snoozeReady, furtherCards, readyCards, weaveReady,
} from '../../../src/pages/Discover/dryDeck'

const NOW = new Date('2026-10-26T12:00:00').getTime()
const DAY = 86400000
const HOME = { lat: 51.88, lng: -0.42 } // Luton
const ids = list => list.map(p => p.id)
const pick = list => list.slice(0, 50) // stand-in for applyDiscoverFilters

beforeEach(() => localStorage.clear())

describe('furtherCards', () => {
  const pool = [
    { id: 1, distance: 3 }, { id: 2, distance: 9 }, { id: 3, distance: 6 },
    { id: 4, distance: 12 }, { id: 5 }, { id: 6, distance: 7 },
  ]

  it('takes only places past the band edge, nearest first, labelled further', () => {
    const out = furtherCards(pool, new Set(), 5, pick)
    expect(ids(out)).toEqual([3, 6, 2, 4])
    expect(out.every(p => p.further)).toBe(true)
  })

  it('skips places already in the deck and places without a distance', () => {
    expect(ids(furtherCards(pool, new Set(['3']), 5, pick))).toEqual([6, 2, 4])
  })

  it('runs the picker (ranking and filters) before ordering by distance', () => {
    const onlyEven = list => list.filter(p => p.id % 2 === 0)
    expect(ids(furtherCards(pool, new Set(), 5, onlyEven))).toEqual([6, 2, 4])
  })

  it(`caps at ${FURTHER_MAX}`, () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: i, distance: 10 + i }))
    expect(furtherCards(many, new Set(), 5, pick)).toHaveLength(FURTHER_MAX)
  })

  it('nothing past the edge: no cards', () => {
    expect(furtherCards(pool, new Set(), 50, pick)).toEqual([])
  })
})

describe('readyCards', () => {
  const near = { id: 'a', name: 'Wardown Park', lat: 51.89, lng: -0.42 } // ~1 km
  const mid = { id: 'b', name: 'Whipsnade', lat: 51.85, lng: -0.55 } // ~10 km
  const far = { id: 'c', name: 'Cambridge', lat: 52.2, lng: 0.12 } // ~50 km
  const opts = (o = {}) => ({ origin: HOME, maxKm: 30, deckIds: new Set(), now: NOW, ...o })

  it('saved places in range, nearest first, with a live distance and the ready flag', () => {
    const out = readyCards([mid, far, near], opts())
    expect(ids(out)).toEqual(['a', 'b'])
    expect(out[0].readyToGo).toBe(true)
    expect(out[0].distance).toBeGreaterThan(0.5)
    expect(out[0].distance).toBeLessThan(2)
  })

  it('leaves out snoozed places, places in the deck and places without coordinates', () => {
    snoozeReady('a', NOW)
    expect(ids(readyCards([near, mid, { id: 'x', name: 'No coords' }], opts({ deckIds: new Set(['b']) })))).toEqual([])
  })

  it('leaves out a place known to be closed now, keeps one with unknown hours', () => {
    const closed = { ...near, id: 'shut', opening_hours: 'Mo-Su 06:00-07:00' }
    expect(ids(readyCards([closed, mid], opts()))).toEqual(['b'])
  })

  it('no location yet: nothing (distances would be wrong)', () => {
    expect(readyCards([near], opts({ origin: null }))).toEqual([])
  })
})

describe('snoozes', () => {
  it(`a snooze lasts ${SNOOZE_DAYS} days, then the place is back`, () => {
    snoozeReady(7, NOW)
    expect(readSnoozes(NOW + (SNOOZE_DAYS - 1) * DAY)).toHaveProperty('7')
    expect(readSnoozes(NOW + SNOOZE_DAYS * DAY + 1)).not.toHaveProperty('7')
  })

  it('expired snoozes are dropped on the next write', () => {
    snoozeReady(1, NOW)
    snoozeReady(2, NOW + (SNOOZE_DAYS + 1) * DAY)
    expect(Object.keys(JSON.parse(localStorage.getItem(SNOOZE_KEY)))).toEqual(['2'])
  })

  it('corrupt storage reads as no snoozes', () => {
    localStorage.setItem(SNOOZE_KEY, '{not json')
    expect(readSnoozes(NOW)).toEqual({})
  })
})

describe('weaveReady', () => {
  const regular = n => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }))
  const ready = n => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, readyToGo: true }))

  it(`one ready card after every ${READY_EVERY - 1} regular cards`, () => {
    const { places, ready: dealt } = weaveReady(regular(9), ready(5))
    expect(ids(places)).toEqual(['r0', 'r1', 'r2', 'r3', 's0', 'r4', 'r5', 'r6', 'r7', 's1', 'r8'])
    expect(dealt).toBe(2)
  })

  it(`never more than 1 in ${READY_EVERY}, never two in a row, whatever the counts`, () => {
    for (let n = 0; n <= 30; n++) {
      for (const m of [0, 1, 3, 40]) {
        const { places } = weaveReady(regular(n), ready(m))
        const flags = places.map(p => Boolean(p.readyToGo))
        expect(flags.filter(Boolean).length * READY_EVERY).toBeLessThanOrEqual(places.length)
        flags.forEach((f, i) => { if (f) expect(flags[i - 1]).toBe(false) })
      }
    }
  })

  it('too few regular cards: no ready card (a deck of only saved places is not Discover)', () => {
    expect(weaveReady(regular(3), ready(5)).ready).toBe(0)
  })
})

describe('topUpDeck: the deck a heavy saver gets (real picker, real seen store)', async () => {
  const { topUpDeck } = await import('../../../src/pages/Discover/dryDeck')
  const { buildFreshDeck, recordSeen, resetSeenCache, FULL_DECK } = await import('../../../src/utils/seenPlaces')
  const { applyDiscoverFilters } = await import('../../../src/pages/Discover/applyFilters')

  const TYPES = ['museum', 'park', 'castle', 'viewpoint', 'gallery', 'pub', 'cafe', 'restaurant', 'garden', 'monument']
  // driving, band "a proper outing" (8-18 km); places spread 8-27 km out
  const at = (i, km) => ({
    id: 7000 + i, name: `Place ${i}`, type: TYPES[i % TYPES.length], website: 'https://x',
    wikipedia: i % 3 === 0 ? 'en:x' : undefined, distance: km,
    lat: HOME.lat + km / 111, lng: HOME.lng,
  })
  const inBand = Array.from({ length: 60 }, (_, i) => at(i, 8.5 + (i % 9)))
  const pastBand = Array.from({ length: 40 }, (_, i) => at(100 + i, 18.5 + (i % 9)))
  const base = [...inBand, ...pastBand]
  const pick = (list, overrides = {}) => applyDiscoverFilters(list, {
    selectedCategories: [], showFreeOnly: false, accessibilityMode: false, showLocalsPicks: false,
    showOffPeak: false, isPremium: false, userProfile: null, weather: null, friendActivity: null,
    includeClosed: true, travelMode: 'driving', selectedBand: 'medium', ...overrides,
  })
  const run = (savedIds, extra = {}) => {
    const freshDeck = buildFreshDeck(base, list => pick(list), { now: NOW })
    const readyPool = base.filter(p => savedIds.includes(p.id))
    return { freshDeck, deck: topUpDeck({ freshDeck, basePlaces: base, readyPool, pick, bandMaxKm: 18, rangeKm: 30, origin: HOME, filtered: false, now: NOW, ...extra }) }
  }

  beforeEach(() => { localStorage.clear(); resetSeenCache() })

  it('nothing saved or swiped: the deck is untouched (same cards, same order)', () => {
    const { freshDeck, deck } = run([])
    expect(freshDeck.dry).toBe(false)
    expect(deck.places).toBe(freshDeck.places)
    expect(deck.further + deck.ready).toBe(0)
  })

  it('most of the band saved: topped up with further cards and saved places, no prompt needed', () => {
    const saved = inBand.slice(0, 52).map(p => p.id)
    saved.forEach(id => recordSeen(id, 'like', NOW))
    resetSeenCache({ keepOwner: true })
    const { freshDeck, deck } = run(saved)
    expect(freshDeck.dry).toBe(true)
    expect(freshDeck.places.length).toBeLessThan(10)
    expect(deck.further).toBeGreaterThan(0)
    expect(deck.ready).toBeGreaterThan(0)
    expect(deck.places.length).toBeGreaterThan(freshDeck.places.length + deck.further)
    // further cards: past the band, nearest first, after the fresh ones
    const further = deck.places.filter(p => p.further)
    expect(further.every(p => p.distance > 18)).toBe(true)
    expect(further.map(p => p.distance)).toEqual([...further.map(p => p.distance)].sort((a, b) => a - b))
    // ready cards: saved places only, never a fresh/further duplicate, 1 in 5 at most
    const ready = deck.places.filter(p => p.readyToGo)
    expect(ready.every(p => saved.includes(p.id))).toBe(true)
    expect(new Set(deck.places.map(p => p.id)).size).toBe(deck.places.length)
    expect(ready.length * 5).toBeLessThanOrEqual(deck.places.length)
    expect(deck.places.length).toBeLessThanOrEqual(FULL_DECK + 20 + 20)
  })

  it('filters on: further cards still come (the picker applies them), ready cards wait', () => {
    const saved = inBand.slice(0, 52).map(p => p.id)
    saved.forEach(id => recordSeen(id, 'like', NOW))
    resetSeenCache({ keepOwner: true })
    const { deck } = run(saved, { filtered: true })
    expect(deck.ready).toBe(0)
    expect(deck.further).toBeGreaterThan(0)
  })

  it('a saved place already visited never comes back (the caller passes unvisited only), snoozed ones neither', () => {
    const saved = inBand.slice(0, 52).map(p => p.id)
    saved.forEach(id => recordSeen(id, 'like', NOW))
    resetSeenCache({ keepOwner: true })
    saved.forEach(id => snoozeReady(id, NOW))
    expect(run(saved).deck.ready).toBe(0)
  })
})

describe('readySwipe', async () => {
  const { readySwipe } = await import('../../../src/pages/Discover/dryDeck')
  const place = { id: 'w1', name: 'Wardown Park', readyToGo: true }
  const handlers = () => ({ plan: vi.fn(), wentOut: vi.fn(), now: NOW })

  it('left: snoozed (back after the snooze), nothing else happens', () => {
    const h = handlers()
    expect(readySwipe('nope', place, h)).toBe('snoozed')
    expect(readSnoozes(NOW)).toHaveProperty('w1')
    expect(h.plan).not.toHaveBeenCalled()
    expect(h.wentOut).not.toHaveBeenCalled()
  })

  it('right: plan it (never a second save), and snoozed so it is not dealt straight back', () => {
    const h = handlers()
    expect(readySwipe('like', place, h)).toBe('plan')
    expect(h.plan).toHaveBeenCalledWith(place)
    expect(readSnoozes(NOW)).toHaveProperty('w1')
  })

  it('up: went out (pending visit + streak), and snoozed', () => {
    const h = handlers()
    expect(readySwipe('go', place, h)).toBe('went')
    expect(h.wentOut).toHaveBeenCalledWith(place)
    expect(readSnoozes(NOW)).toHaveProperty('w1')
  })

  it('never touches the seen store (a saved place stays a like, never a 60-day skip)', async () => {
    const { STORAGE_KEY } = await import('../../../src/utils/seenPlaces')
    for (const a of ['nope', 'like', 'go']) readySwipe(a, place, handlers())
    expect(Object.keys(localStorage).filter(k => k.startsWith(STORAGE_KEY))).toEqual([])
  })
})

describe('round 1 critic fixes (unit)', async () => {
  const { furtherCards: fc, readyCards: rc, withoutDeckFlags } = await import('../../../src/pages/Discover/dryDeck')
  const HOME2 = { lat: 51.88, lng: -0.42 }

  it('further cards stop at the reach: a free driver never gets 30 km+ (Day trip) places', () => {
    const pool = [20, 28, 31, 35, 43].map((d, i) => ({ id: i, distance: d }))
    expect(fc(pool, new Set(), 18, l => l, 30).map(p => p.distance)).toEqual([20, 28])
  })

  it('a place swiped this session is never dealt back as ready', () => {
    const fav = { id: 42, name: 'Fav', lat: 51.89, lng: -0.42 }
    expect(rc([fav], { origin: HOME2, maxKm: 30, deckIds: new Set(), exclude: new Set(['42']) })).toEqual([])
  })

  it('a saved further card comes back with one label: ready, not further', () => {
    const fav = { id: 7, name: 'Fav', lat: 51.89, lng: -0.42, further: true }
    const [card] = rc([fav], { origin: HOME2, maxKm: 30, deckIds: new Set() })
    expect(card.readyToGo).toBe(true)
    expect(card.further).toBeUndefined()
    expect(withoutDeckFlags({ id: 1, further: true, readyToGo: true, name: 'x' })).toEqual({ id: 1, name: 'x' })
  })
})

describe('weaveReady lead (a ready card keeps its place across rebuilds)', async () => {
  const { weaveReady: weave } = await import('../../../src/pages/Discover/dryDeck')
  const regular = n => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }))
  const ready = n => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, readyToGo: true }))
  it('lead 2: the ready card comes after 2 more regular cards, then every 4', () => {
    expect(weave(regular(7), ready(2), 2).places.map(p => p.id)).toEqual(['r0', 'r1', 's0', 'r2', 'r3', 'r4', 'r5', 's1', 'r6'])
  })
  it('lead 0: it is due now (first), then every 4', () => {
    expect(weave(regular(5), ready(2), 0).places.map(p => p.id)).toEqual(['s0', 'r0', 'r1', 'r2', 'r3', 's1', 'r4'])
  })
  it('never two in a row, for any lead', () => {
    for (const lead of [0, 1, 2, 3, 4]) for (let n = 0; n < 15; n++) {
      const flags = weave(regular(n), ready(9), lead).places.map(p => Boolean(p.readyToGo))
      flags.forEach((f, i) => { if (f && i > 0) expect(flags[i - 1]).toBe(false) })
    }
  })
})

describe('aheadOfReady (which cards a ready card sits behind)', async () => {
  const { aheadOfReady } = await import('../../../src/pages/Discover/dryDeck')
  const hand = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 'fav', readyToGo: true }, { id: 4 }, { id: 'fav2', readyToGo: true }]
  it('the unswiped regular cards before the next unswiped ready card, as strings', () => {
    expect([...aheadOfReady(hand, new Set())]).toEqual(['1', '2', '3'])
    expect([...aheadOfReady(hand, new Set([1, 3]))]).toEqual(['2'])
    expect([...aheadOfReady(hand, new Set(['1', '3']))]).toEqual(['2']) // swiped ids as strings match numeric ids
  })
  it('the first ready card swiped: the cards ahead of the next one', () => {
    expect([...aheadOfReady(hand, new Set([1, 2, 3, 'fav']))]).toEqual(['4'])
  })
  it('no ready card left in hand: nothing (the count alone places the next one)', () => {
    expect(aheadOfReady([{ id: 1 }, { id: 2 }], new Set()).size).toBe(0)
    expect(aheadOfReady(hand, new Set(['fav', 'fav2'])).size).toBe(0)
    expect(aheadOfReady([], new Set()).size).toBe(0)
  })
})

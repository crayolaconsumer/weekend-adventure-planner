import { describe, it, expect } from 'vitest'
import {
  planStart, stopMinutes, estimateTravelMinutes, scheduleStops, buildPlan, fitToDuration,
  orderFixedStops, planEndMs, isOpenFor, STOP_MINUTES,
} from '../../../src/pages/Plan/schedule.js'
import { effectiveRadius, TRANSPORT_MODES, RADIUS_OPTIONS } from '../../../src/pages/Plan/constants.js'
import { appendStops } from '../../../src/pages/Plan/appendStops.js'
import { readDraft, writeDraft, clearDraft, DRAFT_KEY } from '../../../src/pages/Plan/draft.js'

const MIN = 60000
const home = { lat: 51.5, lng: -0.12 }
// ~111 m per 0.001 deg of latitude
const north = (km, extra = {}) => ({ lat: 51.5 + km / 111, lng: -0.12, ...extra })
const place = (id, key, km, extra = {}) => ({ id, name: id, category: { key }, ...north(km), ...extra })
const walk = (a, b) => estimateTravelMinutes(a, b, 5)
const at = (h, m = 0) => new Date(2026, 8, 26, h, m) // a Saturday

describe('planStart', () => {
  it('starts now, rounded up to the quarter hour', () => {
    expect(planStart(at(14, 7))).toEqual(at(14, 15))
    expect(planStart(at(14, 0))).toEqual(at(14, 0))
  })
  it('starts at 10:00 next morning late at night, and 10:00 early in the morning', () => {
    expect(planStart(at(22, 30))).toEqual(new Date(2026, 8, 27, 10, 0))
    expect(planStart(at(6, 0))).toEqual(at(10, 0))
  })
})

describe('slot sizes and travel', () => {
  it('sizes a stop by its category', () => {
    expect(stopMinutes({ category: { key: 'food' } })).toBe(STOP_MINUTES.food)
    expect(stopMinutes({ category: { key: 'unique' } })).toBeLessThan(stopMinutes({ category: { key: 'entertainment' } }))
    expect(stopMinutes({})).toBe(60)
  })
  it('walks 1 km (as the crow flies) in about 16 minutes', () => {
    expect(walk(home, north(1))).toBe(16)
  })
})

describe('scheduleStops', () => {
  it('runs stops back to back: travel, then the stay', () => {
    const [a, b] = scheduleStops([place('a', 'food', 1), place('b', 'unique', 2)], { start: at(12), origin: home, travel: walk })
    expect(new Date(a.scheduledTime)).toEqual(at(12, 20)) // 16 min walk, rounded to 5
    expect(a.duration).toBe(75)
    expect(new Date(b.scheduledTime)).toEqual(at(13, 55)) // 12:20 + 75 + 16 -> 13:55
    expect(b.duration).toBe(30)
  })
  it('flags a stop that is closed at its slot', () => {
    const [s] = scheduleStops([place('s', 'food', 0, { openingHours: 'Mo-Su 18:00-23:00' })], { start: at(12), travel: walk })
    expect(s.closedAtSlot).toBe(true)
  })
})

describe('isOpenFor', () => {
  it('needs the place open on arrival and halfway through', () => {
    const p = { openingHours: 'Mo-Su 09:00-17:00' }
    expect(isOpenFor(p, at(12), 60)).toBe(true)
    expect(isOpenFor(p, at(16, 45), 60)).toBe(false)
    expect(isOpenFor({}, at(12))).toBe(null)
  })
})

describe('buildPlan', () => {
  it('keeps user-added stops and generates after them', () => {
    const mine = { ...place('mine', 'culture', 0.5), userAdded: true }
    const plan = buildPlan({
      fixed: [mine],
      candidates: [place('c1', 'food', 0.8), place('c2', 'nature', 1)],
      count: 3, start: at(10), durationMinutes: 360, origin: home, travel: walk,
    })
    expect(plan[0].id).toBe('mine')
    expect(plan.map(s => s.id)).toEqual(expect.arrayContaining(['mine', 'c1', 'c2']))
  })

  it('keeps a walking half day inside 4 hours even when places are spread out', () => {
    const candidates = Array.from({ length: 12 }, (_, i) => place(`p${i}`, ['food', 'culture', 'nature', 'historic'][i % 4], 1 + i))
    const plan = buildPlan({ candidates, count: 3, start: at(10), durationMinutes: 240, origin: home, travel: walk })
    expect(plan.length).toBeGreaterThan(0)
    expect(planEndMs(plan)).toBeLessThanOrEqual(at(14).getTime())
  })

  it('never picks a place that is closed at its slot', () => {
    const plan = buildPlan({
      candidates: [place('shut', 'food', 0.1, { openingHours: 'Mo-Su 18:00-23:00' }), place('open', 'culture', 0.5)],
      count: 2, start: at(10), durationMinutes: 240, origin: home, travel: walk,
    })
    expect(plan.map(s => s.id)).toEqual(['open'])
  })

  it('prefers a new category, and the nearest of those', () => {
    const plan = buildPlan({
      candidates: [place('food1', 'food', 0.2), place('food2', 'food', 0.3), place('far-museum', 'culture', 1.5), place('near-park', 'nature', 0.6)],
      count: 3, start: at(10), durationMinutes: 480, origin: home, travel: walk,
    })
    expect(plan.map(s => s.id)).toEqual(['food1', 'near-park', 'far-museum'])
  })
})

describe('orderFixedStops', () => {
  it('moves a stop that opens later to later in the day', () => {
    const evening = place('bar', 'nightlife', 0.2, { openingHours: 'Mo-Su 11:30-23:00' })
    const museum = place('museum', 'culture', 0.3)
    const plan = orderFixedStops([evening, museum], { start: at(10), origin: home, travel: walk })
    expect(plan.map(s => s.id)).toEqual(['museum', 'bar'])
    expect(plan.every(s => !s.closedAtSlot)).toBe(true)
  })
})

describe('fitToDuration', () => {
  it('drops generated stops from the end when real travel is slower, never the user\'s', () => {
    const planned = [
      { ...place('mine', 'culture', 0.5), userAdded: true },
      place('gen1', 'food', 1), place('gen2', 'nature', 1.5),
    ]
    const slow = () => 30
    const fitted = fitToDuration(planned, { start: at(10), origin: home, travel: slow, durationMinutes: 240 })
    expect(fitted.map(s => s.id)).toEqual(['mine', 'gen1'])
    expect(planEndMs(fitted)).toBeLessThanOrEqual(at(14).getTime())
  })
})

describe('effectiveRadius', () => {
  const mode = key => TRANSPORT_MODES.find(m => m.key === key)
  const radius = key => RADIUS_OPTIONS.find(r => r.key === key)
  it('caps walking plans at 2 km and leaves driving at the chosen radius', () => {
    expect(effectiveRadius(radius('local'), mode('walk'))).toBe(2000)
    expect(effectiveRadius(radius('local'), mode('drive'))).toBe(10000)
    expect(effectiveRadius(radius('daytrip'), mode('transit'))).toBe(25000)
  })
})

describe('appendStops', () => {
  const cafe = place('p1', 'food', 0.5)
  it('marks stops as user-added, starts now and chains by travel and stay', () => {
    const a = appendStops([], [cafe, place('p2', 'unique', 1), cafe], home, { now: at(14, 7) })
    expect(a.map(s => s.id)).toEqual(['p1', 'p2'])
    expect(a.every(s => s.userAdded)).toBe(true)
    expect(new Date(a[0].scheduledTime)).toEqual(at(14, 25)) // 14:15 start + 8 min walk, rounded
    expect(a[0].duration).toBe(75)
    expect(new Date(a[1].scheduledTime)).toEqual(at(15, 50)) // 15:40 + 8 min, rounded
  })
})

describe('plan draft', () => {
  it('round-trips, clears on empty, and ignores corrupt data', () => {
    writeDraft({ itinerary: [{ id: 1 }], vibe: 'culture' })
    expect(readDraft()).toEqual({ itinerary: [{ id: 1 }], vibe: 'culture' })
    // A day-old draft has stale stop times: ignored
    const stale = JSON.parse(localStorage.getItem(DRAFT_KEY))
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...stale, savedAt: Date.now() - 25 * 60 * 60 * 1000 }))
    expect(readDraft()).toBeNull()
    writeDraft({ itinerary: [] })
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    localStorage.setItem(DRAFT_KEY, '{bad')
    expect(readDraft()).toBeNull()
    clearDraft()
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
  })
})

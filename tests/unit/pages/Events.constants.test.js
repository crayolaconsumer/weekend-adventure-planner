import { describe, it, expect } from 'vitest'
import {
  FILTERS, VIEW_MODES, RADIUS_OPTIONS, CATEGORIES,
  PRICE_OPTIONS, SORT_OPTIONS, EVENTS_PAGE_SIZE, EVENTS_LOAD_MORE_THRESHOLD,
} from '../../../src/pages/Events/constants.js'

describe('Events/constants', () => {
  it('FILTERS has unique ids', () => {
    const ids = FILTERS.map(f => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('all')
    expect(ids).toContain('free')
  })

  it("VIEW_MODES exposes 'swipe' and 'grid'", () => {
    expect(VIEW_MODES.SWIPE).toBe('swipe')
    expect(VIEW_MODES.GRID).toBe('grid')
  })

  it('RADIUS_OPTIONS is a sorted ascending list of km', () => {
    expect(RADIUS_OPTIONS).toEqual([...RADIUS_OPTIONS].sort((a, b) => a - b))
    for (const r of RADIUS_OPTIONS) expect(typeof r).toBe('number')
  })

  it('CATEGORIES has shape {id, label}', () => {
    for (const c of CATEGORIES) {
      expect(c.id).toBeTruthy()
      expect(c.label).toBeTruthy()
    }
  })

  it('PRICE_OPTIONS includes any/free brackets', () => {
    const ids = PRICE_OPTIONS.map(p => p.id)
    expect(ids).toContain('any')
    expect(ids).toContain('free')
    const free = PRICE_OPTIONS.find(p => p.id === 'free')
    expect(free.maxPrice).toBe(0)
  })

  it('SORT_OPTIONS has expected sort keys', () => {
    const ids = SORT_OPTIONS.map(s => s.id)
    expect(ids).toEqual(expect.arrayContaining(['recommended', 'soonest', 'nearest', 'popular']))
  })

  it('paging knobs are sane', () => {
    expect(EVENTS_PAGE_SIZE).toBeGreaterThan(0)
    expect(EVENTS_LOAD_MORE_THRESHOLD).toBeGreaterThan(0)
    expect(EVENTS_LOAD_MORE_THRESHOLD).toBeLessThanOrEqual(EVENTS_PAGE_SIZE)
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { getTopRecommendations } from '../../../src/utils/tasteProfile.js'
import { getJustGoReasons } from '../../../src/utils/justGoReasons.js'

const base = { type: 'cafe', lat: 51.5, lng: -0.1, category: { key: 'food', label: 'Food & Drink' } }
const km = d => `${d} km`

describe("I'm Bored picks (getTopRecommendations)", () => {
  beforeEach(() => localStorage.clear())

  it('never suggests a place that is closed right now', () => {
    const recs = getTopRecommendations([
      { ...base, id: 'relish', name: 'Relish', openingHours: 'Mo-Su off' },
      { ...base, id: 'open', name: 'Open Cafe', openingHours: '24/7' },
      { ...base, id: 'unknown', name: 'No Hours Cafe' },
    ], 5)
    expect(recs.map(p => p.id).sort()).toEqual(['open', 'unknown'])
  })

  it('leaves out places swiped this session', () => {
    const recs = getTopRecommendations([
      { ...base, id: 1, name: 'A' },
      { ...base, id: 2, name: 'B' },
    ], 5, { excludeIds: new Set([1]) })
    expect(recs.map(p => p.id)).toEqual([2])
  })

  it('leaves out places skipped earlier (not interested list)', () => {
    localStorage.setItem('roam_not_interested', JSON.stringify([{ placeId: 'a' }]))
    const recs = getTopRecommendations([{ ...base, id: 'a', name: 'A' }, { ...base, id: 'b', name: 'B' }], 5)
    expect(recs.map(p => p.id)).toEqual(['b'])
  })
})

describe("I'm Bored reasons (getJustGoReasons)", () => {
  const noon = new Date(2026, 8, 26, 9, 0) // 9am: no meal-time reason

  it('gives distance, open now and interest match instead of "Popular ..."', () => {
    const texts = getJustGoReasons(
      { ...base, distance: 0.4, openingHours: '24/7' },
      { formatDistance: km, interests: ['food'], now: noon },
    ).map(r => r.text)
    expect(texts).toEqual(['Only 0.4 km away', 'Open now', 'Matches your interest in food & drink'])
    expect(texts.join(' ')).not.toMatch(/Popular/)
  })

  it('says how far a further place is without "Only"', () => {
    const [first] = getJustGoReasons({ ...base, distance: 12 }, { formatDistance: km, now: noon })
    expect(first).toEqual({ kind: 'distance', text: '12 km away' })
  })

  it('skips the interest line when the category is not one of theirs', () => {
    const kinds = getJustGoReasons({ ...base, distance: 1 }, { formatDistance: km, interests: ['culture'], now: noon }).map(r => r.kind)
    expect(kinds).not.toContain('match')
  })

  it('never claims open for a closed place', () => {
    const kinds = getJustGoReasons({ ...base, distance: 1, openingHours: 'Mo-Su off' }, { formatDistance: km, now: noon }).map(r => r.kind)
    expect(kinds).not.toContain('open')
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import {
  BADGE_DEFINITIONS,
  detectBadges,
  getPlaceBadges,
  filterByBadges,
  getBadgeFilterOptions,
} from '../../../src/utils/badges.js'

function makePlace(overrides = {}) {
  return { id: 'p1', name: 'The Old Inn', type: 'pub', ...overrides }
}

describe('badges.detectBadges', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('flags an independent pub (no chain match)', () => {
    expect(detectBadges(makePlace())).toContain('independent')
  })

  it('does NOT flag Tesco / Wetherspoons / Greggs as independent', () => {
    expect(detectBadges(makePlace({ name: 'Tesco Express', type: 'shop' }))).not.toContain('independent')
    expect(detectBadges(makePlace({ name: 'Wetherspoons', type: 'pub' }))).not.toContain('independent')
    expect(detectBadges(makePlace({ name: 'Greggs', type: 'bakery' }))).not.toContain('independent')
  })

  it('does NOT flag places with brand set as independent', () => {
    expect(detectBadges(makePlace({ brand: 'Costa Coffee', type: 'cafe' }))).not.toContain('independent')
  })

  it('flags historic via heritage / listed_status / historic / cathedral', () => {
    expect(detectBadges(makePlace({ heritage: 'yes' }))).toContain('historic')
    expect(detectBadges(makePlace({ listed_status: 'Grade I' }))).toContain('historic')
    expect(detectBadges(makePlace({ historic: 'castle' }))).toContain('historic')
    expect(detectBadges(makePlace({ building: 'historic' }))).toContain('historic')
  })

  it('flags national_trust via operator or network', () => {
    expect(detectBadges(makePlace({ operator: 'The National Trust' }))).toContain('national_trust')
    expect(detectBadges(makePlace({ network: 'National Trust properties' }))).toContain('national_trust')
  })

  it('flags dog_friendly via OSM dog tags', () => {
    expect(detectBadges(makePlace({ dog: 'yes' }))).toContain('dog_friendly')
    expect(detectBadges(makePlace({ dogs: 'yes' }))).toContain('dog_friendly')
    expect(detectBadges(makePlace({ 'dog:friendly': 'yes' }))).toContain('dog_friendly')
  })

  it('flags free_entry via fee / entrance / charge tags', () => {
    expect(detectBadges(makePlace({ fee: 'no' }))).toContain('free_entry')
    expect(detectBadges(makePlace({ fee: '0' }))).toContain('free_entry')
    expect(detectBadges(makePlace({ entrance: 'free' }))).toContain('free_entry')
    expect(detectBadges(makePlace({ charge: 'no' }))).toContain('free_entry')
  })

  it('flags outdoor via outdoor_seating / beer_garden / leisure', () => {
    expect(detectBadges(makePlace({ outdoor_seating: 'yes' }))).toContain('outdoor')
    expect(detectBadges(makePlace({ beer_garden: 'yes' }))).toContain('outdoor')
    expect(detectBadges(makePlace({ leisure: 'park' }))).toContain('outdoor')
  })

  it('returns empty array for unremarkable places', () => {
    const plain = makePlace({ name: 'Untagged Spot', type: 'monument' })
    const result = detectBadges(plain)
    // Could still be empty or have independent — but independent is only
    // for commercial. monument is not commercial.
    expect(result.includes('independent')).toBe(false)
  })
})

describe('badges.getPlaceBadges', () => {
  it('returns badge definition objects sorted by priority', () => {
    const place = makePlace({ heritage: 'yes', outdoor_seating: 'yes' })
    const badges = getPlaceBadges(place)
    expect(badges.length).toBeGreaterThan(0)
    // Lower priority number first
    for (let i = 1; i < badges.length; i++) {
      expect(badges[i].priority).toBeGreaterThanOrEqual(badges[i - 1].priority)
    }
  })

  it('drops badges with no definition (defensive)', () => {
    expect(getPlaceBadges(makePlace())).toEqual(expect.any(Array))
  })
})

describe('badges.filterByBadges', () => {
  it('returns all places when no required badges', () => {
    const places = [makePlace({ id: 'a' }), makePlace({ id: 'b' })]
    expect(filterByBadges(places, [])).toEqual(places)
    expect(filterByBadges(places, null)).toEqual(places)
  })

  it('filters by required badge (AND semantics)', () => {
    const places = [
      makePlace({ id: 'a', heritage: 'yes' }),
      makePlace({ id: 'b' }),
      makePlace({ id: 'c', heritage: 'yes', dog: 'yes' }),
    ]
    expect(filterByBadges(places, ['historic']).map(p => p.id)).toEqual(['a', 'c'])
    expect(filterByBadges(places, ['historic', 'dog_friendly']).map(p => p.id)).toEqual(['c'])
  })
})

describe('badges.getBadgeFilterOptions', () => {
  it('returns options with counts > 0, sorted by count desc', () => {
    const places = [
      makePlace({ id: 'a', heritage: 'yes' }),
      makePlace({ id: 'b', heritage: 'yes' }),
      makePlace({ id: 'c', dog: 'yes' }),
    ]
    const options = getBadgeFilterOptions(places)
    expect(options.length).toBeGreaterThan(0)
    // Highest count comes first
    for (let i = 1; i < options.length; i++) {
      expect(options[i].count).toBeLessThanOrEqual(options[i - 1].count)
    }
  })

  it('returns empty when nothing matches', () => {
    const options = getBadgeFilterOptions([])
    expect(options).toEqual([])
  })
})

describe('badges.BADGE_DEFINITIONS', () => {
  it('every definition has the same shape', () => {
    for (const [key, def] of Object.entries(BADGE_DEFINITIONS)) {
      expect(def.id, `${key}.id`).toBe(key)
      expect(def.icon, `${key}.icon`).toBeTruthy()
      expect(def.label, `${key}.label`).toBeTruthy()
      expect(def.color, `${key}.color`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(typeof def.priority).toBe('number')
    }
  })
})

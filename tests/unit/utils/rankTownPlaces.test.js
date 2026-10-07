import { describe, it, expect } from 'vitest'
import { rankTownPlaces } from '../../../src/utils/rankTownPlaces'

describe('rankTownPlaces', () => {
  it('quality first, then fame breaks the ties at the 100 cap (regression: ID order put the London Bridge Experience first)', () => {
    const ranked = rankTownPlaces([
      { name: 'London Bridge Experience', qualityScore: 100, fame: 0 },
      { name: 'Corner Cafe', qualityScore: 60, fame: 0 },
      { name: 'Tower of London', qualityScore: 100, fame: 10 },
      { name: 'Westminster Abbey', qualityScore: 100, fame: 40 },
    ])
    expect(ranked.map(p => p.name)).toEqual(['Westminster Abbey', 'Tower of London', 'London Bridge Experience', 'Corner Cafe'])
  })

  it('places from older caches without fame still sort, and the input is not mutated', () => {
    const input = [{ name: 'a', qualityScore: 50 }, { name: 'b', qualityScore: 90 }]
    expect(rankTownPlaces(input).map(p => p.name)).toEqual(['b', 'a'])
    expect(input.map(p => p.name)).toEqual(['a', 'b'])
  })
})

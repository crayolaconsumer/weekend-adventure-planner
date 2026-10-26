import { describe, it, expect } from 'vitest'
import { matchesPlaceQuery } from '../../../src/utils/placeSearch'

const fleece = { name: 'The Golden Fleece', address: '16 Pavement, York', type: 'pub', category: { key: 'food', label: 'Food & Drink' } }

describe('matchesPlaceQuery', () => {
  it('empty or whitespace query matches everything', () => {
    expect(matchesPlaceQuery(fleece, '')).toBe(true)
    expect(matchesPlaceQuery(fleece, '   ')).toBe(true)
    expect(matchesPlaceQuery(fleece, undefined)).toBe(true)
  })
  it('matches name, address, type and category label, case-insensitively', () => {
    expect(matchesPlaceQuery(fleece, 'golden')).toBe(true)
    expect(matchesPlaceQuery(fleece, 'YORK')).toBe(true)
    expect(matchesPlaceQuery(fleece, 'pub')).toBe(true)
    expect(matchesPlaceQuery(fleece, 'drink')).toBe(true)
  })
  it('requires every word, across fields', () => {
    expect(matchesPlaceQuery(fleece, 'pub york')).toBe(true)
    expect(matchesPlaceQuery(fleece, 'pub leeds')).toBe(false)
  })
  it('ignores accents both ways and underscores in type', () => {
    expect(matchesPlaceQuery({ name: 'Café Nero' }, 'cafe')).toBe(true)
    expect(matchesPlaceQuery({ name: 'Cafe Nero' }, 'café')).toBe(true)
    expect(matchesPlaceQuery({ name: 'X', type: 'ice_cream' }, 'ice cream')).toBe(true)
  })
  it('survives sparse legacy rows', () => {
    expect(matchesPlaceQuery({ category: 'food' }, 'food')).toBe(true)
    expect(matchesPlaceQuery({}, 'x')).toBe(false)
    expect(matchesPlaceQuery(null, 'x')).toBe(false)
  })
})

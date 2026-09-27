import { describe, it, expect, beforeEach } from 'vitest'
import { recordLocalSkip } from '../../../src/hooks/useSwipedPlaces'

const read = () => JSON.parse(localStorage.getItem('roam_not_interested'))

describe('recordLocalSkip (single writer for roam_not_interested)', () => {
  beforeEach(() => localStorage.clear())

  it('writes one entry per skip in the shape tasteProfile reads', () => {
    recordLocalSkip('p1', { categoryKey: 'food', placeType: 'cafe' })
    expect(read()).toEqual([{ placeId: 'p1', categoryKey: 'food', placeType: 'cafe', timestamp: expect.any(Number) }])
    recordLocalSkip('p1', { categoryKey: 'food' })
    expect(read()).toHaveLength(1)
  })

  it('keeps only the newest 50', () => {
    for (let i = 0; i < 60; i++) recordLocalSkip(`p${i}`)
    const list = read()
    expect(list).toHaveLength(50)
    expect(list[0].placeId).toBe('p10')
    expect(list[49].placeId).toBe('p59')
  })

  it('survives a corrupt stored value', () => {
    localStorage.setItem('roam_not_interested', '{not json')
    expect(() => recordLocalSkip('p1')).not.toThrow()
    expect(read().map(e => e.placeId)).toEqual(['p1'])
  })
})

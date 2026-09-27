import { describe, it, expect } from 'vitest'
import { MOODS, activeMood } from '../../../src/pages/Plan/moods'

// Regression: a "Cosy" plan (bookshops, cafés, quiet corners) put a
// graveyard in the itinerary because Cosy mapped to the catch-all Mix vibe.
describe('Plan moods', () => {
  it('Cosy biases to cafés, shops and culture and never picks graveyards', () => {
    const cosy = activeMood('cozy', 'mixed')
    expect(cosy.categories).toEqual(expect.arrayContaining(['food', 'shopping']))
    expect(cosy.avoidTypes).toContain('grave_yard')
  })

  it('stops applying once the user picks a different vibe by hand', () => {
    expect(activeMood('cozy', 'foodie')).toBeNull()
    expect(activeMood(null, 'mixed')).toBeNull()
  })

  it('every mood vibe is one the planner knows', () => {
    for (const m of MOODS) expect(['mixed', 'foodie', 'culture', 'nature']).toContain(m.vibe)
  })
})

import { describe, it, expect } from 'vitest'
import { contourLayout } from '../../../src/utils/placeArt'

// Photo-less cards (80% of places around Luton, 2 Oct) get seeded contour art
describe('contourLayout', () => {
  it('is the same picture for the same place, every render', () => {
    expect(contourLayout('n3729176844')).toEqual(contourLayout('n3729176844'))
  })

  it('differs between places', () => {
    const a = contourLayout('n3729176844').rings[3].d
    expect(contourLayout('n663946506').rings[3].d).not.toBe(a)
  })

  it('keeps the summit in the top third, clear of the card text', () => {
    for (const id of ['w23335063', 'n1', 'x', '', null, undefined, 42]) {
      const { sx, sy } = contourLayout(id)
      expect(sy).toBeGreaterThanOrEqual(0.2)
      expect(sy).toBeLessThanOrEqual(0.3)
      expect(sx).toBeGreaterThanOrEqual(0.35)
      expect(sx).toBeLessThanOrEqual(0.65)
    }
  })

  it('draws closed paths with no NaN', () => {
    for (const ring of contourLayout('w23335063').rings) expect(ring.d).toMatch(/^M[\d.-]+,[\d.-]+(C[\d., -]+)+Z$/)
  })
})

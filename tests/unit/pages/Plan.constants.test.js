import { describe, it, expect } from 'vitest'
import { VIBES, DURATIONS, TRANSPORT_MODES, RADIUS_OPTIONS, VIBE_ICONS } from '../../../src/pages/Plan/constants.js'

describe('Plan/constants', () => {
  it('every VIBE has a matching VIBE_ICONS entry', () => {
    for (const v of VIBES) {
      expect(VIBE_ICONS, v.key).toHaveProperty(v.key)
    }
  })

  it('DURATIONS escalate stops with hours', () => {
    for (let i = 1; i < DURATIONS.length; i++) {
      expect(DURATIONS[i].hours).toBeGreaterThan(DURATIONS[i - 1].hours)
      expect(DURATIONS[i].stops).toBeGreaterThanOrEqual(DURATIONS[i - 1].stops)
    }
  })

  it('TRANSPORT_MODES walk speed is below driving/transit', () => {
    const walk = TRANSPORT_MODES.find(m => m.key === 'walk')
    const drive = TRANSPORT_MODES.find(m => m.key === 'drive')
    const transit = TRANSPORT_MODES.find(m => m.key === 'transit')
    expect(walk.speed).toBeLessThan(transit.speed)
    expect(transit.speed).toBeLessThan(drive.speed)
  })

  it('RADIUS_OPTIONS escalate', () => {
    for (let i = 1; i < RADIUS_OPTIONS.length; i++) {
      expect(RADIUS_OPTIONS[i].radius).toBeGreaterThan(RADIUS_OPTIONS[i - 1].radius)
    }
  })

  it("'mixed' vibe has null categories (matches every category)", () => {
    const mixed = VIBES.find(v => v.key === 'mixed')
    expect(mixed.categories).toBe(null)
  })
})

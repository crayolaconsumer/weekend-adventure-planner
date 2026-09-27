import { describe, it, expect } from 'vitest'
import { snapQueryBbox, SNAP_GRID_DEGREES } from '../../../api/lib/bboxSnap.js'
import { buildDiscoverOverpassQuery } from '../../../shared/overpassQuery.js'

const bboxOf = (q) => {
  const m = q.match(/\[bbox:(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\]/)
  if (!m) return null
  const [, south, west, north, east] = m
  return {
    south: parseFloat(south),
    west: parseFloat(west),
    north: parseFloat(north),
    east: parseFloat(east),
  }
}

describe('snapQueryBbox — cache key sharing', () => {
  it('gives nearby users an IDENTICAL query, so they share one cache entry', () => {
    // Two users ~40 m apart in central London. Before snapping these produced
    // different bboxes, different hashes, and shared nothing.
    const a = buildDiscoverOverpassQuery(51.5074, -0.1278, 5000, null).query
    const b = buildDiscoverOverpassQuery(51.50776, -0.12744, 5000, null).query

    expect(a).not.toBe(b) // precondition: raw queries genuinely differ
    expect(snapQueryBbox(a)).toBe(snapQueryBbox(b))
  })

  it('still separates genuinely different areas', () => {
    const london = buildDiscoverOverpassQuery(51.5074, -0.1278, 5000, null).query
    const manchester = buildDiscoverOverpassQuery(53.4808, -2.2426, 5000, null).query
    expect(snapQueryBbox(london)).not.toBe(snapQueryBbox(manchester))
  })

  it('separates different radii at the same location', () => {
    const walking = buildDiscoverOverpassQuery(51.5074, -0.1278, 5000, null).query
    const driving = buildDiscoverOverpassQuery(51.5074, -0.1278, 30000, null).query
    expect(snapQueryBbox(walking)).not.toBe(snapQueryBbox(driving))
  })

  it('is idempotent — snapping an already-snapped query changes nothing', () => {
    const q = buildDiscoverOverpassQuery(51.5074, -0.1278, 5000, null).query
    const once = snapQueryBbox(q)
    expect(snapQueryBbox(once)).toBe(once)
  })
})

describe('snapQueryBbox — geometry is preserved', () => {
  it('grows the box by at most one grid cell per axis, and never shrinks it', () => {
    const q = buildDiscoverOverpassQuery(51.5074, -0.1278, 5000, null).query
    const before = bboxOf(q)
    const after = bboxOf(snapQueryBbox(q))

    const latGrowth = after.north - after.south - (before.north - before.south)
    const lngGrowth = after.east - after.west - (before.east - before.west)

    // Growth is intentional. The centre moves by up to half a cell, so each
    // half-extent is padded by half a cell to guarantee containment. The box
    // must never come back SMALLER — that would hide places from the user.
    expect(latGrowth).toBeGreaterThanOrEqual(0)
    expect(lngGrowth).toBeGreaterThanOrEqual(0)
    expect(latGrowth).toBeLessThanOrEqual(SNAP_GRID_DEGREES + 0.002)
    expect(lngGrowth).toBeLessThanOrEqual(SNAP_GRID_DEGREES + 0.004)
  })

  it('never moves the centre by more than half a grid cell', () => {
    const q = buildDiscoverOverpassQuery(51.5074, -0.1278, 5000, null).query
    const before = bboxOf(q)
    const after = bboxOf(snapQueryBbox(q))

    const shiftLat = Math.abs((after.north + after.south) / 2 - (before.north + before.south) / 2)
    const shiftLng = Math.abs((after.east + after.west) / 2 - (before.east + before.west) / 2)

    expect(shiftLat).toBeLessThanOrEqual(SNAP_GRID_DEGREES / 2 + 1e-9)
    expect(shiftLng).toBeLessThanOrEqual(SNAP_GRID_DEGREES / 2 + 1e-9)
  })
})

describe('snapQueryBbox — fails open', () => {
  it('returns queries without a bbox untouched', () => {
    const q = '[out:json][timeout:25];node(around:2000,51.5,-0.12)["amenity"="cafe"];out body;'
    expect(snapQueryBbox(q)).toBe(q)
  })

  it('leaves malformed and out-of-range bboxes alone rather than guessing', () => {
    const inverted = '[out:json][bbox:52.0,-0.2,51.0,-0.1];node["amenity"];out;'
    const tooBig = '[out:json][bbox:-91.0,-0.2,51.0,-0.1];node["amenity"];out;'
    expect(snapQueryBbox(inverted)).toBe(inverted)
    expect(snapQueryBbox(tooBig)).toBe(tooBig)
  })

  it('tolerates non-string input', () => {
    expect(snapQueryBbox(null)).toBe(null)
    expect(snapQueryBbox(undefined)).toBe(undefined)
  })
})

describe('snapQueryBbox — regressions found in review', () => {
  it('leaves a non-canonical rectangle ALONE instead of widening it 160x', () => {
    // Found by adversarial review. Extents are re-derived from the north/south
    // span, so a tall thin box used to come back ~160x wider — silently
    // returning data for the wrong area on a public endpoint.
    const q = '[out:json][timeout:25][bbox:51,-0.13,52,-0.12];nw["amenity"];out center;'
    expect(snapQueryBbox(q)).toBe(q)
  })

  it('still snaps boxes that radiusToBbox actually produces', () => {
    const q = buildDiscoverOverpassQuery(51.5074, -0.1278, 5000, null).query
    expect(snapQueryBbox(q)).not.toBe(q)
  })
})

describe('snapQueryBbox — never loses places (containment)', () => {
  it('the snapped box always CONTAINS the requested box', () => {
    // Randomised sweep: whatever the caller asked for must still be covered,
    // otherwise a user silently loses places near the trailing edge.
    let seed = 7
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }

    for (let i = 0; i < 500; i++) {
      const lat = 49 + rnd() * 10          // UK-ish latitudes
      const lng = -8 + rnd() * 10
      const radius = [5000, 15000, 30000, 35000][Math.floor(rnd() * 4)]
      const q = buildDiscoverOverpassQuery(lat, lng, radius, null).query
      const before = bboxOf(q)
      const after = bboxOf(snapQueryBbox(q))

      expect(after.south).toBeLessThanOrEqual(before.south + 1e-9)
      expect(after.north).toBeGreaterThanOrEqual(before.north - 1e-9)
      expect(after.west).toBeLessThanOrEqual(before.west + 1e-9)
      expect(after.east).toBeGreaterThanOrEqual(before.east - 1e-9)
    }
  })
})

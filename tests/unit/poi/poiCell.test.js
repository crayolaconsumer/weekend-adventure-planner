// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { poiCell, cellRanges, isLarge, CELL_PAD_DEG, LARGE_EPS } from '../../../shared/poiCell.mjs'
import { featureToRow } from '../../../scripts/poi/build.mjs'
import { makeMatcher } from '../../../scripts/poi/filter.mjs'

const formula = (lat, lon) => Math.floor((lat + 90) * 10) * 3600 + Math.floor((lon + 180) * 10)

describe('poiCell', () => {
  it('matches the CONTRACT formula, including negative lat/lon', () => {
    for (const [lat, lon] of [[51.5074, -0.1278], [54.597, -5.93], [-33.86, 151.2], [-0.05, -0.05], [0, 0], [55.95, -3.19]]) {
      expect(poiCell(lat, lon)).toBe(formula(lat, lon))
    }
  })

  it('puts exact boundaries in the cell to their north/east', () => {
    expect(poiCell(51.5, -0.1)).toBe(poiCell(51.55, -0.05))
    expect(poiCell(51.4999999, -0.1000001)).toBe(poiCell(51.45, -0.15))
    expect(poiCell(0, 0)).toBe(900 * 3600 + 1800)
    expect(poiCell(-0.0000001, -0.0000001)).toBe(899 * 3600 + 1799)
  })

  it('clamps the poles and the antimeridian into the grid', () => {
    expect(poiCell(-90, -180)).toBe(0)
    expect(poiCell(90, 180)).toBe(1799 * 3600 + 3599)
    expect(poiCell(90, 0)).toBe(poiCell(89.95, 0))
  })
})

describe('cellRanges', () => {
  it('gives one [lo, hi] range per 0.1° latitude row', () => {
    const r = cellRanges(51.45, -0.25, 51.62, 0.05)
    expect(r).toEqual([
      [poiCell(51.45, -0.25), poiCell(51.45, 0.05)],
      [poiCell(51.55, -0.25), poiCell(51.55, 0.05)],
      [poiCell(51.62, -0.25), poiCell(51.62, 0.05)],
    ])
  })

  it('contains the cell of every point inside the bbox, edges included', () => {
    const [s, w, n, e] = [54.5, -6.1, 54.72, -5.8]
    const ranges = cellRanges(s, w, n, e)
    const covered = c => ranges.some(([lo, hi]) => c >= lo && c <= hi)
    for (let lat = s; lat <= n; lat += 0.01) {
      for (let lon = w; lon <= e; lon += 0.01) expect(covered(poiCell(lat, lon))).toBe(true)
    }
    for (const [lat, lon] of [[s, w], [s, e], [n, w], [n, e]]) expect(covered(poiCell(lat, lon))).toBe(true)
    expect(covered(poiCell(n + 0.1, e))).toBe(false)
    expect(covered(poiCell(s, w - 0.1))).toBe(false)
  })

  it('a bbox inside one cell is one single-cell range', () => {
    const c = poiCell(51.51, -0.12)
    expect(cellRanges(51.51, -0.12, 51.52, -0.11)).toEqual([[c, c]])
  })

  it('splits a bbox that crosses the antimeridian', () => {
    const r = cellRanges(-17.1, 179.9, -17.05, -179.9)
    expect(r).toEqual([[poiCell(-17.1, 179.9), poiCell(-17.1, 179.99)], [poiCell(-17.1, -180), poiCell(-17.1, -179.9)]])
  })
})

describe('isLarge (the one threshold the build and the loader share)', () => {
  const box = (w, span) => ({ min_lat: 51.2, max_lat: 51.21, min_lon: w, max_lon: w + span })

  it('exactly 2 × CELL_PAD_DEG wide is NOT large, even with float noise; wider is', () => {
    expect(isLarge(box(-4.5, 2 * CELL_PAD_DEG))).toBe(false) // -4.5 + 0.4 - -4.5 = 0.40000000000000036
    expect(isLarge(box(-4.5 + 1e-7, 2 * CELL_PAD_DEG))).toBe(false)
    expect(isLarge(box(-4.5, 2 * CELL_PAD_DEG + 1e-7))).toBe(true) // 1e-7 = one unit of the 7 dp rounding
    expect(LARGE_EPS).toBeLessThan(1e-7)
  })

  it('uses the widest side, latitude too', () => {
    expect(isLarge({ min_lat: 51, max_lat: 51.5, min_lon: 0, max_lon: 0.01 })).toBe(true)
    expect(isLarge({ min_lat: 51, max_lat: 51, min_lon: 0, max_lon: 0 })).toBe(false)
  })

  it('the build files rows with exactly this function (boundary rows round-trip)', () => {
    const match = makeMatcher()
    for (const span of [0.4, 0.4000001, 0.3999999, 0.41]) {
      const row = featureToRow({ id: 'w1', properties: { natural: 'bay', name: 'B' }, geometry: { type: 'LineString', coordinates: [[-4.5, 51.2], [-4.5 + span, 51.21]] } }, match)
      expect(row.cell === 0, String(span)).toBe(isLarge(row))
    }
  })
})

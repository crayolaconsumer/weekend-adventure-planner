import { describe, it, expect } from 'vitest'
import { haversineKm } from '../../../shared/geo.mjs'

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm(51.5074, -0.1278, 51.5074, -0.1278)).toBe(0)
  })

  it('London to Paris is about 343.5 km', () => {
    expect(haversineKm(51.5074, -0.1278, 48.8566, 2.3522)).toBeCloseTo(343.56, 1)
  })

  it('one degree of latitude on the meridian is about 111.19 km', () => {
    expect(haversineKm(0, 0, 1, 0)).toBeCloseTo(111.195, 2)
  })

  it('one degree of longitude shrinks with latitude (argument order lat, lng)', () => {
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo(111.195, 2)
    expect(haversineKm(60, 0, 60, 1)).toBeCloseTo(55.6, 1)
  })

  it('is symmetric', () => {
    expect(haversineKm(53.48, -2.24, 55.95, -3.19)).toBeCloseTo(haversineKm(55.95, -3.19, 53.48, -2.24), 10)
  })

  it('handles antipodes without NaN', () => {
    expect(haversineKm(0, 0, 0, 180)).toBeCloseTo(Math.PI * 6371, 3)
  })
})

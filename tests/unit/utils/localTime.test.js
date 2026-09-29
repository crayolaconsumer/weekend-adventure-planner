import { describe, it, expect } from 'vitest'
import { localTimeAt } from '../../../src/utils/localTime'

describe('localTimeAt', () => {
  it('uses UK summer time (BST) in July', () => {
    // 13:00 UTC -> 14:00 London
    expect(localTimeAt(51.5, -0.1, new Date('2026-07-01T13:00:00Z')).hour).toBe(14)
  })

  it('uses GMT in winter', () => {
    expect(localTimeAt(51.5, -0.1, new Date('2026-01-15T13:00:00Z')).hour).toBe(13)
  })

  it('applies US eastern offset with DST', () => {
    // New York: UTC-5 winter, UTC-4 summer
    expect(localTimeAt(40.7, -74, new Date('2026-01-15T12:00:00Z')).hour).toBe(7)
    expect(localTimeAt(40.7, -74, new Date('2026-07-01T12:00:00Z')).hour).toBe(8)
  })

  it('applies southern-hemisphere offset with season-flipped DST', () => {
    // Sydney: UTC+10 in July, UTC+11 in January
    expect(localTimeAt(-33.9, 151.2, new Date('2026-07-01T13:00:00Z')).hour).toBe(23)
    expect(localTimeAt(-33.9, 151.2, new Date('2026-01-15T13:00:00Z')).hour).toBe(0)
  })

  it('rolls the day forward across the date line', () => {
    // Friday 23:00 UTC is Saturday morning in Sydney (+10 in May, no DST)
    const t = localTimeAt(-33.9, 151.2, new Date('2026-05-08T23:00:00Z'))
    expect(t.day).toBe(6) // Saturday
  })
})

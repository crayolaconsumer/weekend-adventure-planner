import { describe, it, expect } from 'vitest'
import { weatherVerdict } from '../../../src/utils/placeFilter.js'

// Drives the I'm Bored "indoor option" copy, which used to show on every
// indoor place because it read a weather.isGood field that never existed.
describe('weatherVerdict', () => {
  it('returns null when weather is unknown', () => {
    expect(weatherVerdict(null)).toBe(null)
    expect(weatherVerdict({})).toBe(null)
  })
  it('flags rain, showers, snow and storms as wet', () => {
    for (const weatherCode of [61, 80, 73, 95, 51]) {
      expect(weatherVerdict({ weatherCode, temperature: 15 })).toBe('wet')
    }
  })
  it('flags dry but cold weather as cold', () => {
    expect(weatherVerdict({ weatherCode: 1, temperature: 3 })).toBe('cold')
  })
  it('calls clear mild weather fine', () => {
    expect(weatherVerdict({ weatherCode: 1, temperature: 14 })).toBe('fine')
  })
})

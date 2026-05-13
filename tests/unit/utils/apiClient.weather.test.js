import { describe, it, expect } from 'vitest'
import { getWeatherDescription } from '../../../src/utils/apiClient/weather.js'

describe('apiClient/weather.getWeatherDescription', () => {
  it('returns clear-sky family', () => {
    expect(getWeatherDescription(0)).toBe('Clear sky')
    expect(getWeatherDescription(1)).toBe('Mainly clear')
    expect(getWeatherDescription(2)).toBe('Partly cloudy')
    expect(getWeatherDescription(3)).toBe('Overcast')
  })

  it('returns rain family for 61/63/65', () => {
    expect(getWeatherDescription(61)).toMatch(/rain/i)
    expect(getWeatherDescription(63)).toMatch(/rain/i)
    expect(getWeatherDescription(65)).toMatch(/heavy rain/i)
  })

  it('returns snow family for 71/73/75', () => {
    expect(getWeatherDescription(71)).toMatch(/snow/i)
    expect(getWeatherDescription(75)).toMatch(/heavy snow/i)
  })

  it('returns thunderstorm for 95', () => {
    expect(getWeatherDescription(95)).toMatch(/thunder/i)
  })

  it("returns 'Unknown' for unmapped codes", () => {
    expect(getWeatherDescription(999)).toBe('Unknown')
    expect(getWeatherDescription(-1)).toBe('Unknown')
    expect(getWeatherDescription(null)).toBe('Unknown')
    expect(getWeatherDescription(undefined)).toBe('Unknown')
  })
})

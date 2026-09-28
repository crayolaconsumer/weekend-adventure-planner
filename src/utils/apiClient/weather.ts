/**
 * Weather lookup via our /api/weather (MET Norway data, licensed for commercial
 * use; credit "Data from MET Norway"). Open-Meteo's free tier excludes apps
 * with ads, so the app no longer calls it.
 *
 * Heavily cached in-memory (30 min) because the Discover page calls
 * fetchWeather on every refresh + every time the user pans, and the
 * WMO weather_code is the input to TIME / WEATHER boosts in placeFilter.
 */

export interface WeatherData {
  temperature: number
  weatherCode: number
  description: string
}

interface WeatherCacheEntry {
  data: WeatherData
  timestamp: number
}

// In-memory weather cache (more aggressive than general cache)
const weatherCache = new Map<string, WeatherCacheEntry>()
const WEATHER_CACHE_TTL = 30 * 60 * 1000 // 30 minutes

/**
 * Get weather description from WMO code.
 * Source: https://open-meteo.com/en/docs (WMO weather interpretation codes)
 */
export function getWeatherDescription(code: number | null | undefined): string {
  if (code == null) return 'Unknown'
  const descriptions: Record<number, string> = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    71: 'Slight snow',
    73: 'Moderate snow',
    75: 'Heavy snow',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    95: 'Thunderstorm',
  }
  return descriptions[code] || 'Unknown'
}

/**
 * Fetch weather for a location. In-memory cached 30 minutes per
 * 0.1° lat/lng cell (the proxy's); on fetch failure returns stale cache if any.
 */
export async function fetchWeather(lat: number, lng: number): Promise<WeatherData | null> {
  // The proxy's 0.1° cell (~10 km): every user in it shares one CDN entry,
  // and sending the cell's exact values avoids the proxy's redirect
  const cellLat = Math.round(lat * 10) / 10
  const cellLng = Math.round(lng * 10) / 10
  const cacheKey = `${cellLat},${cellLng}`

  // Check in-memory cache first
  const cached = weatherCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < WEATHER_CACHE_TTL) {
    return cached.data
  }

  try {
    const response = await fetch(`/api/weather?lat=${cellLat}&lng=${cellLng}`)

    if (response.ok) {
      const data = await response.json() as { temperature: number; weatherCode: number }
      const weather: WeatherData = {
        temperature: data.temperature,
        weatherCode: data.weatherCode,
        description: getWeatherDescription(data.weatherCode),
      }

      // Cache the result
      weatherCache.set(cacheKey, { data: weather, timestamp: Date.now() })

      return weather
    }
  } catch (error) {
    console.warn('Weather fetch failed:', error)

    // Return stale cache on error
    if (cached) {
      return cached.data
    }
  }
  return null
}

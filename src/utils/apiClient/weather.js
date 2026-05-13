/**
 * Weather lookup via Open-Meteo (free, no API key).
 *
 * Heavily cached in-memory (30 min) because the Discover page calls
 * fetchWeather on every refresh + every time the user pans, and the
 * WMO weather_code is the input to TIME / WEATHER boosts in placeFilter.
 * We don't need fresh-to-the-minute data here.
 */

// In-memory weather cache (more aggressive than general cache)
const weatherCache = new Map()
const WEATHER_CACHE_TTL = 30 * 60 * 1000 // 30 minutes

/**
 * Get weather description from WMO code
 * Source: https://open-meteo.com/en/docs (WMO weather interpretation codes)
 */
export function getWeatherDescription(code) {
  const descriptions = {
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
 * 0.01° lat/lng bucket; on fetch failure returns stale cache if any.
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<{temperature: number, weatherCode: number, description: string}|null>}
 */
export async function fetchWeather(lat, lng) {
  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)}`

  // Check in-memory cache first
  const cached = weatherCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < WEATHER_CACHE_TTL) {
    return cached.data
  }

  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&timezone=auto`,
    )

    if (response.ok) {
      const data = await response.json()
      const weather = {
        temperature: data.current.temperature_2m,
        weatherCode: data.current.weather_code,
        description: getWeatherDescription(data.current.weather_code),
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

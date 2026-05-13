/**
 * Geocoding via Nominatim (OpenStreetMap's free public instance).
 *
 * Both reverseGeocode and geocodeAddress are deliberately direct fetch
 * calls (no managedFetch) — Nominatim has its own rate-limit policy
 * (1 req/s) and we use these endpoints sparingly enough that the global
 * circuit breaker would be more noise than signal.
 *
 * User-Agent is required by Nominatim's usage policy.
 */

const NOMINATIM_API = 'https://nominatim.openstreetmap.org'
const USER_AGENT = 'ROAM/1.0 (go-roam.uk)'

/**
 * Reverse geocode coordinates to a human-readable address.
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<string|null>} display_name or null on failure
 */
export async function reverseGeocode(lat, lng) {
  try {
    const response = await fetch(
      `${NOMINATIM_API}/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`,
      { headers: { 'User-Agent': USER_AGENT } },
    )

    if (response.ok) {
      const data = await response.json()
      return data.display_name
    }
  } catch (error) {
    console.warn('Reverse geocode failed:', error)
  }
  return null
}

/**
 * Geocode an address string to coordinates.
 *
 * @param {string} address - Address text
 * @returns {Promise<{lat: number, lng: number}|null>} or null on failure
 */
export async function geocodeAddress(address) {
  try {
    const response = await fetch(
      `${NOMINATIM_API}/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
      { headers: { 'User-Agent': USER_AGENT } },
    )

    if (response.ok) {
      const data = await response.json()
      if (data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
        }
      }
    }
  } catch (error) {
    console.warn('Geocode failed:', error)
  }
  return null
}

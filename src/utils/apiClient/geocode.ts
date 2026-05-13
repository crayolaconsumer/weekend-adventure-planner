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
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const response = await fetch(
      `${NOMINATIM_API}/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`,
      { headers: { 'User-Agent': USER_AGENT } },
    )

    if (response.ok) {
      const data = await response.json() as { display_name?: string }
      return data.display_name ?? null
    }
  } catch (error) {
    console.warn('Reverse geocode failed:', error)
  }
  return null
}

/**
 * Geocode an address string to coordinates.
 */
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const response = await fetch(
      `${NOMINATIM_API}/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
      { headers: { 'User-Agent': USER_AGENT } },
    )

    if (response.ok) {
      const data = await response.json() as Array<{ lat: string; lon: string }>
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

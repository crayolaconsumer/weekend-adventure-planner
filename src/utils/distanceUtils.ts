/**
 * Distance Utilities
 *
 * Centralized distance formatting for km/mi unit preference.
 * Conversion constants:
 * - 1 km = 0.621371 miles
 * - 1 m = 3.28084 feet
 */

const KM_TO_MILES = 0.621371
const METERS_TO_FEET = 3.28084

export type DistanceUnit = 'km' | 'mi'

export interface FormatDistanceOptions {
  /** Include " away" suffix (default: false) */
  withSuffix?: boolean
  /** Use short unit labels like "km" / "mi" (default: true) */
  short?: boolean
}

/**
 * Format a distance value for display based on unit preference.
 *
 * Display logic:
 * - km mode: <1km shows meters (e.g., "850m"), >=1km shows km (e.g., "2.3km")
 * - mi mode: <0.1mi shows feet (e.g., "450ft"), >=0.1mi shows miles (e.g., "1.4mi")
 */
export function formatDistance(
  km: number | null | undefined,
  unit: DistanceUnit = 'km',
  options: FormatDistanceOptions = {},
): string | null {
  if (km == null || Number.isNaN(km)) return null

  const { withSuffix = false, short = true } = options
  const suffix = withSuffix ? ' away' : ''

  if (unit === 'mi') {
    const miles = km * KM_TO_MILES

    // Very short distances: show feet
    if (miles < 0.1) {
      const feet = Math.round(km * 1000 * METERS_TO_FEET)
      return `${feet}${short ? 'ft' : ' feet'}${suffix}`
    }

    // Long distances: round to whole numbers
    if (miles >= 10) {
      return `${Math.round(miles)}${short ? 'mi' : ' miles'}${suffix}`
    }

    // Normal distances: 1 decimal place
    return `${miles.toFixed(1)}${short ? 'mi' : ' miles'}${suffix}`
  }

  // Default: kilometers
  // Very short distances: show meters
  if (km < 1) {
    return `${Math.round(km * 1000)}${short ? 'm' : ' meters'}${suffix}`
  }

  // Long distances: round to whole numbers
  if (km >= 10) {
    return `${Math.round(km)}${short ? 'km' : ' kilometers'}${suffix}`
  }

  // Normal distances: 1 decimal place
  return `${km.toFixed(1)}${short ? 'km' : ' kilometers'}${suffix}`
}

/**
 * Get the unit label for display.
 */
export function getUnitLabel(unit: DistanceUnit, short: boolean = true): string {
  if (unit === 'mi') {
    return short ? 'mi' : 'miles'
  }
  return short ? 'km' : 'kilometers'
}

/**
 * Convert a distance in km to the display unit value (for input fields).
 */
export function convertToDisplayUnit(km: number | null | undefined, unit: DistanceUnit): number {
  if (km == null || Number.isNaN(km)) return 0
  return unit === 'mi' ? km * KM_TO_MILES : km
}

/**
 * Convert a distance from display unit back to km (for storage).
 */
export function convertToKm(value: number | null | undefined, unit: DistanceUnit): number {
  if (value == null || Number.isNaN(value)) return 0
  return unit === 'mi' ? value / KM_TO_MILES : value
}

export default { formatDistance, getUnitLabel, convertToDisplayUnit, convertToKm }

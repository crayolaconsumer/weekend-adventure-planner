/**
 * Distance bands — per-travel-mode "how far?" filter.
 *
 * The travel mode answers HOW the user is getting there; the band
 * answers HOW FAR within that mode. The two are independent dials so
 * a user can ask for "a long walk" or "a short drive" — different
 * effort levels expressed in language that fits the mode.
 *
 * Bands are pure client-side filters: the API still fetches the full
 * radius for the mode (keeps the KV cache hot and predictable),
 * and the band narrows the visible set without a network round-trip.
 *
 * Naming is the "Adventure framing" voice — active verbs that lean
 * into the ROAM brand. Edit labels here; the slider component reads
 * directly from this file.
 */

export type DistanceBandKey = 'short' | 'medium' | 'long'

export interface DistanceBand {
  key: DistanceBandKey
  label: string
  // Min/max distance in METRES. minMeters is inclusive; maxMeters is
  // inclusive too (`distance <= max`) so the three bands cover the
  // full mode radius with no gaps.
  minMeters: number
  maxMeters: number
}

export type TravelModeKey = 'walking' | 'transit' | 'driving' | 'dayTrip' | 'explorer'

export const DEFAULT_BAND: DistanceBandKey = 'medium'

export const DISTANCE_BANDS: Record<TravelModeKey, Record<DistanceBandKey, DistanceBand>> = {
  walking: {
    short:  { key: 'short',  label: 'Step outside',       minMeters: 0,    maxMeters: 1500 },
    medium: { key: 'medium', label: 'Stretch your legs',  minMeters: 1500, maxMeters: 3000 },
    long:   { key: 'long',   label: 'Hit the path',       minMeters: 3000, maxMeters: 5000 },
  },
  transit: {
    short:  { key: 'short',  label: 'Just a hop',          minMeters: 0,    maxMeters: 4000 },
    medium: { key: 'medium', label: 'Cross-town journey',  minMeters: 4000, maxMeters: 9000 },
    long:   { key: 'long',   label: 'The grand tour',      minMeters: 9000, maxMeters: 15000 },
  },
  driving: {
    short:  { key: 'short',  label: 'A quick jaunt',       minMeters: 0,     maxMeters: 8000 },
    medium: { key: 'medium', label: 'A proper outing',     minMeters: 8000,  maxMeters: 18000 },
    long:   { key: 'long',   label: 'An honest adventure', minMeters: 18000, maxMeters: 30000 },
  },
  dayTrip: {
    short:  { key: 'short',  label: 'A nearby escape',     minMeters: 30000, maxMeters: 50000 },
    medium: { key: 'medium', label: 'A real day out',      minMeters: 50000, maxMeters: 65000 },
    long:   { key: 'long',   label: 'A proper expedition', minMeters: 65000, maxMeters: 75000 },
  },
  explorer: {
    short:  { key: 'short',  label: 'An open-road run',    minMeters: 75000,  maxMeters: 100000 },
    medium: { key: 'medium', label: 'Into the wild',       minMeters: 100000, maxMeters: 125000 },
    long:   { key: 'long',   label: 'Where the road ends', minMeters: 125000, maxMeters: 150000 },
  },
}

/**
 * Bands for a given travel mode in slider order (short → medium → long).
 * Falls back to walking if an unrecognised mode is passed in (defensive
 * — shouldn't happen in practice).
 */
export function getBandsFor(mode: string): DistanceBand[] {
  const modeBands = DISTANCE_BANDS[mode as TravelModeKey] || DISTANCE_BANDS.walking
  return [modeBands.short, modeBands.medium, modeBands.long]
}

/**
 * Single band lookup by mode + band key. Returns null if the mode
 * isn't recognised so callers can no-op cleanly.
 */
export function getBandFor(mode: string, band: DistanceBandKey): DistanceBand | null {
  const modeBands = DISTANCE_BANDS[mode as TravelModeKey]
  if (!modeBands) return null
  return modeBands[band] || null
}

/**
 * localStorage key for the sticky per-mode band preference. Each
 * travel mode remembers its own last-used band, so switching from
 * "long walk" to "long drive" feels natural.
 */
export function bandStorageKey(mode: string): string {
  return `roam_distance_band:${mode}`
}

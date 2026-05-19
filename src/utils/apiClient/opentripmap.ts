/**
 * OpenTripMap proxy client — fetches curated tourist places via our
 * /api/places/opentripmap/* routes (the OTM key is server-side only).
 *
 * Wrapped in managedFetch for circuit-breaker + rate-limit + dedupe.
 * 503 responses mean the OTM proxy is unconfigured (no API key set on
 * the server) — surfaced as an empty result rather than an error so
 * Discover can fall back to OSM-only without a banner.
 */

import { managedFetch, isCircuitOpen } from '../requestManager'
import { makeKey } from '../geoCache'
import type { CategoryKey } from '../categories'

interface OtmPlace {
  xid?: string
  name?: string
  kinds?: string
  lat?: number
  lng?: number
  [key: string]: unknown
}

interface EnhancedOtmPlace extends OtmPlace {
  type: string
}

/**
 * Map OpenTripMap "kinds" string to our category key.
 */
const OTM_KIND_MAPPING: Record<string, CategoryKey | null> = {
  // Nature
  natural: 'nature',
  beaches: 'nature',
  gardens_and_parks: 'nature',
  nature_reserves: 'nature',
  geological_formations: 'nature',
  water: 'nature',
  // Culture
  museums: 'culture',
  theatres_and_entertainments: 'culture',
  cultural: 'culture',
  art_galleries: 'culture',
  // Historic
  historic: 'historic',
  architecture: 'historic',
  historic_architecture: 'historic',
  castles: 'historic',
  churches: 'historic',
  monuments_and_memorials: 'historic',
  archaeological: 'historic',
  // Food
  foods: 'food',
  restaurants: 'food',
  cafes: 'food',
  pubs: 'food',
  // Entertainment / shopping / unique
  amusements: 'entertainment',
  sport: 'active',
  accomodations: null, // Skip hotels
  shops: 'shopping',
  marketplaces: 'shopping',
  interesting_places: 'unique',
  view_points: 'unique',
  lighthouses: 'unique',
}

/**
 * Map OTM kinds string to our category key (with fallback patterns).
 */
export function mapOtmKind(kinds: string | null | undefined): string {
  if (!kinds) return 'unique'
  const kindList = kinds.split(',')

  for (const kind of kindList) {
    const mapped = OTM_KIND_MAPPING[kind.trim()]
    if (mapped) return mapped
  }

  // Default mapping based on common patterns
  if (kinds.includes('historic')) return 'historic'
  if (kinds.includes('museum')) return 'culture'
  if (kinds.includes('natural') || kinds.includes('park')) return 'nature'
  if (kinds.includes('restaurant') || kinds.includes('food')) return 'food'

  return 'unique'
}

class OtmError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/**
 * Fetch places from OpenTripMap by radius.
 */
export async function fetchOpenTripMapPlaces(
  lat: number,
  lng: number,
  radius: number = 5000,
  kinds: string | null = null,
): Promise<EnhancedOtmPlace[]> {
  // Check circuit breaker before making request
  if (isCircuitOpen('opentripmap')) {
    return []
  }

  const cacheKey = makeKey('otm', lat, lng, radius, kinds)

  const result = await managedFetch('opentripmap', cacheKey, async () => {
    let url = `/api/places/opentripmap/nearby?lat=${lat}&lng=${lng}&radius=${radius}`

    if (kinds) {
      url += `&kinds=${kinds}`
    }

    const response = await fetch(url)

    if (!response.ok) {
      // 503 means OTM not configured - don't treat as error
      if (response.status === 503) {
        return [] as EnhancedOtmPlace[]
      }
      throw new OtmError(`OpenTripMap request failed: ${response.status}`, response.status)
    }

    const data = await response.json() as { places?: OtmPlace[] }
    const places = data.places || []

    // Map to our format with category
    return places.map<EnhancedOtmPlace>(place => ({
      ...place,
      type: mapOtmKind(place.kinds),
    }))
  }, { ttl: 10 * 60 * 1000 }) // 10 minute cache

  return (result as EnhancedOtmPlace[] | null) || []
}

/**
 * Fetch detailed place info from OpenTripMap.
 */
export async function fetchOpenTripMapDetails(xid: string): Promise<Record<string, unknown> | null> {
  // Skip if circuit is open
  if (isCircuitOpen('opentripmap')) {
    return null
  }

  const cacheKey = makeKey('otm_detail', xid)

  const result = await managedFetch('opentripmap', cacheKey, async () => {
    const response = await fetch(`/api/places/opentripmap/details?xid=${xid}`)

    if (!response.ok) {
      // 503 means OTM not configured
      if (response.status === 503) {
        return null
      }
      throw new OtmError(`OpenTripMap details failed: ${response.status}`, response.status)
    }

    const data = await response.json() as Record<string, unknown>
    if (data.unavailable) return null
    return data
  }, { ttl: 30 * 60 * 1000 }) // 30 minute cache for details

  return result as Record<string, unknown> | null
}

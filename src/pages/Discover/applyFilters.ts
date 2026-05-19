/**
 * Pure filtering pipeline for Discover places.
 *
 * Extracted from Discover.jsx so it's testable in isolation and so the
 * page component can stay focused on data loading + render. The component
 * still calls this from a useCallback that closes over the relevant
 * filter state — the only thing that changed is the function moved out
 * of the component and now takes everything as explicit args.
 */

import { filterPlaces } from '../../utils/placeFilter'
import { isPlaceOpen } from '../../utils/openingHours'
import { getBandFor, type DistanceBandKey } from './distanceBands'

interface PlaceLike {
  type?: string
  fee?: string
  wheelchair?: string
  tourism?: string
  brand?: string
  name?: string
  qualityScore?: number
  openingHours?: string
  opening_hours?: string
  lat?: number
  lng?: number
  // Added by enhancePlace before filtering — distance from user in KM.
  distance?: number | null
  [key: string]: unknown
}

export interface ApplyFiltersOptions {
  selectedCategories: string[]
  showFreeOnly: boolean
  accessibilityMode: boolean
  showOpenOnly: boolean
  showLocalsPicks: boolean
  showOffPeak: boolean
  isPremium: boolean
  userProfile: unknown
  weather: unknown
  friendActivity: unknown
  // Distance band + travel mode — narrows the candidate set to places
  // within the user's chosen effort level (e.g. "long walk" = 3-5km).
  // Both must be present to apply; either being absent skips the band
  // filter entirely (back-compat with code paths that haven't been
  // updated).
  travelMode?: string
  selectedBand?: DistanceBandKey
}

/**
 * Build a stable string key from the current filter selection. Used to
 * detect whether the filter state has changed enough to warrant a refetch.
 */
export function buildFilterKey(opts: {
  travelMode: string
  showFreeOnly: boolean
  accessibilityMode: boolean
  showOpenOnly: boolean
  showLocalsPicks: boolean
  showOffPeak: boolean
  selectedCategories: string[]
}): string {
  const { travelMode, showFreeOnly, accessibilityMode, showOpenOnly, showLocalsPicks, showOffPeak, selectedCategories } = opts
  const categoriesKey = [...selectedCategories].sort().join('|')
  // NB: selectedBand is deliberately NOT part of this key. The key is
  // used to discard stale FETCHES — but band filtering is purely
  // client-side, never a fetch input. Including it caused a race when
  // travel mode changed: the band-restore effect would update
  // selectedBand AFTER the mode-triggered fetch had fired with the
  // old band's key, invalidating the in-flight match and silently
  // dropping the result. filteredPlaces invalidates correctly via
  // applyFilters' own dep list, so band changes still re-filter.
  return `${travelMode}|${showFreeOnly}|${accessibilityMode}|${showOpenOnly}|${showLocalsPicks}|${showOffPeak}|${categoriesKey}`
}

const CHAIN_NAME_REGEX = /^(Costa|Starbucks|McDonald|Wetherspoon|Greggs|Pret|Subway|KFC|Burger King|Pizza Hut|Domino|Nando)/i

/**
 * Apply Discover's full filter pipeline:
 *
 *   1. Run the smart filter (category + score + diversity) via filterPlaces.
 *   2. Apply UI toggles: free only, accessibility, open now, locals' picks
 *      (premium), off-peak (premium).
 *   3. Sort by qualityScore when locals' picks is active.
 */
export function applyDiscoverFilters<T extends PlaceLike>(
  list: T[] | null | undefined,
  options: ApplyFiltersOptions,
): T[] {
  if (!list || list.length === 0) return []

  const {
    selectedCategories,
    showFreeOnly,
    accessibilityMode,
    showOpenOnly,
    showLocalsPicks,
    showOffPeak,
    isPremium,
    userProfile,
    weather,
    friendActivity,
    travelMode,
    selectedBand,
  } = options

  const hasActiveFilters =
    showFreeOnly ||
    accessibilityMode ||
    showOpenOnly ||
    (showLocalsPicks && isPremium) ||
    (showOffPeak && isPremium)

  // Distance band filter — pre-narrow the candidate pool before the
  // smart selector runs, so its diversity weave operates within the
  // user's chosen effort level (e.g. "a proper outing" = 8-18km drive).
  // Distance on places is in KM (set by enhancePlace), band thresholds
  // are in METRES — convert when comparing. Places without a distance
  // value (rare, would mean missing user location) are kept so we
  // don't accidentally hide everything during the location-loading
  // window.
  let candidates: T[] = list
  if (travelMode && selectedBand) {
    const band = getBandFor(travelMode, selectedBand)
    if (band) {
      const minKm = band.minMeters / 1000
      const maxKm = band.maxMeters / 1000
      candidates = list.filter(p => {
        if (typeof p.distance !== 'number') return true
        return p.distance >= minKm && p.distance <= maxKm
      })
    }
  }

  let filtered = filterPlaces(candidates as never, {
    categories: selectedCategories.length > 0 ? selectedCategories : null,
    minScore: 30,
    maxResults: 50,
    sortBy: 'smart',
    weather,
    ensureDiversity: true,
    userProfile,
    friendActivity,
  }) as T[]

  if (!hasActiveFilters) return filtered

  filtered = filtered.filter((p) => {
    // Free only filter
    if (showFreeOnly) {
      const isFree =
        !p.fee || p.fee === 'no' || p.type?.includes('park') || p.type?.includes('viewpoint')
      if (!isFree) return false
    }

    // Accessibility filter
    if (accessibilityMode) {
      const isAccessible = p.wheelchair === 'yes' || p.wheelchair === 'limited' || !p.wheelchair
      if (!isAccessible) return false
    }

    // Open now filter
    if (showOpenOnly) {
      const openStatus = isPlaceOpen(p)
      if (openStatus === false) return false
    }

    // Premium: Locals' picks — filter out tourist traps and chains
    if (showLocalsPicks && isPremium) {
      const isTouristTrap = p.tourism === 'attraction' || p.tourism === 'theme_park'
      if (isTouristTrap) return false

      const isChain = p.brand || (p.name && CHAIN_NAME_REGEX.test(p.name))
      if (isChain) return false

      if (typeof p.qualityScore === 'number' && p.qualityScore < 30) return false
    }

    // Premium: Off-peak times
    if (showOffPeak && isPremium) {
      const now = new Date()
      const hour = now.getHours()
      const isWeekend = now.getDay() === 0 || now.getDay() === 6
      const type = p.type || ''

      if (type.includes('restaurant') || type.includes('cafe')) {
        if ((hour >= 12 && hour <= 14) || (hour >= 18 && hour <= 20)) return false
      } else if (type.includes('park') || type.includes('nature') || type.includes('viewpoint')) {
        if (isWeekend && hour >= 10 && hour <= 16) return false
      } else if (type.includes('museum') || type.includes('attraction') || type.includes('castle')) {
        if (isWeekend && hour >= 11 && hour <= 15) return false
      } else if (type.includes('pub') || type.includes('bar')) {
        if (hour >= 17 && hour <= 21) return false
      }
    }

    return true
  })

  // Sort by quality score if locals picks is active
  if (showLocalsPicks && isPremium) {
    filtered.sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))
  }

  return filtered
}

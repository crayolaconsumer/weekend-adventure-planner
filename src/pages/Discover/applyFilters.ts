/**
 * Pure filtering pipeline for Discover places.
 *
 * Extracted from Discover.jsx so it's testable in isolation and so the
 * page component can stay focused on data loading + render. The component
 * still calls this from a useCallback that closes over the relevant
 * filter state — the only thing that changed is the function moved out
 * of the component and now takes everything as explicit args.
 */

import { filterPlaces, isClosedNow } from '../../utils/placeFilter'
import { getOpeningState } from '../../utils/openingHours'
import { getBandFor, type DistanceBandKey } from './distanceBands'
import { localTimeAt } from '../../utils/localTime'
import { isChainPlace } from '../../utils/badges'

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
  showLocalsPicks: boolean
  showOffPeak: boolean
  showDogs: boolean
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
  // Places closed right now (by their opening_hours) are left out of the
  // deck unless the user asks for places that open later. Unknown hours stay.
  includeClosed?: boolean
  // Reorder the ranked deck nearest-first. Client-side only (never a fetch
  // input), so it is deliberately kept out of buildFilterKey, like the band.
  sortByDistance?: boolean
}

// Below this many open cards the deck offers places that open later
export const MIN_OPEN_CARDS = 8

/**
 * When the first of these closed places opens again, or null if none of
 * them has a known next opening.
 */
export function firstOpening(places: PlaceLike[]): Date | null {
  let first: Date | null = null
  for (const p of places) {
    if (!isClosedNow(p)) continue
    const state = getOpeningState((p.openingHours || p.opening_hours) as string, p) as { nextChange?: Date | null }
    const next = state.nextChange ?? null
    if (next && (!first || next < first)) first = next
  }
  return first
}

/**
 * Build a stable string key from the current filter selection. Used to
 * detect whether the filter state has changed enough to warrant a refetch.
 */
export function buildFilterKey(opts: {
  travelMode: string
  showFreeOnly: boolean
  accessibilityMode: boolean
  showLocalsPicks: boolean
  showOffPeak: boolean
  showDogs: boolean
  selectedCategories: string[]
}): string {
  const { travelMode, showFreeOnly, accessibilityMode, showLocalsPicks, showOffPeak, showDogs, selectedCategories } = opts
  const categoriesKey = [...selectedCategories].sort().join('|')
  // NB: selectedBand is deliberately NOT part of this key. The key is
  // used to discard stale FETCHES — but band filtering is purely
  // client-side, never a fetch input. Including it caused a race when
  // travel mode changed: the band-restore effect would update
  // selectedBand AFTER the mode-triggered fetch had fired with the
  // old band's key, invalidating the in-flight match and silently
  // dropping the result. filteredPlaces invalidates correctly via
  // applyFilters' own dep list, so band changes still re-filter.
  return `${travelMode}|${showFreeOnly}|${accessibilityMode}|${showLocalsPicks}|${showOffPeak}|${showDogs}|${categoriesKey}`
}

// OSM dog=* values that mean "you can bring the dog": yes, conditional
// (with the terms in dog:conditional), leashed, unleashed, and outside
// (the terrace). "no" and "designated" (a dog-care business) are not.
// A MISSING tag is unknown — never "yes". A dog-friendly deck must not
// deal a place that may ban dogs.
const DOG_FRIENDLY_VALUES = ['yes', 'conditional', 'leashed', 'unleashed', 'outside']
export function isDogFriendly(dog: unknown): boolean {
  return DOG_FRIENDLY_VALUES.includes(typeof dog === 'string' ? dog : '')
}

// Open green spaces where a missing dog tag means "unknown", not "banned".
// A dog is usually fine here, so we pass them but mark the pass as inferred
// (the card shows "usually dog-friendly", not the confirmed badge).
const OPEN_GREEN_TYPES = ['park', 'common', 'recreation_ground', 'wood', 'heath', 'moor']
// Nature reserves and beaches carry explicit dog restrictions we must not
// override — they stay on the strict explicit-tag rule.
const STRICT_TYPES = ['nature_reserve', 'beach']

/**
 * Type-aware bring-the-dog check. Returns whether the place passes the
 * filter and whether the pass is inferred (no explicit dog tag) or
 * confirmed (an explicit dog=yes/leashed/… tag).
 *
 *   - dog_park: always passes, never inferred (built for dogs).
 *   - nature_reserve / beach: strict — explicit tag only.
 *   - park / common / recreation_ground / wood / heath / moor: pass when
 *     the dog tag is missing (inferred), fail only on dog=no; an explicit
 *     friendly tag is confirmed.
 *   - everything else: strict — explicit tag only.
 */
export function dogCheck(p: PlaceLike): { pass: boolean, inferred: boolean } {
  const dog = typeof p.dog === 'string' ? p.dog : ''
  const type = p.type || ''
  if (type.includes('dog_park')) return { pass: true, inferred: false }
  if (STRICT_TYPES.some(t => type.includes(t))) {
    return { pass: isDogFriendly(dog), inferred: false }
  }
  if (OPEN_GREEN_TYPES.some(t => type.includes(t))) {
    if (dog === 'no') return { pass: false, inferred: false }
    if (isDogFriendly(dog)) return { pass: true, inferred: false }
    return { pass: true, inferred: true }
  }
  return { pass: isDogFriendly(dog), inferred: false }
}

/**
 * The UI-eligibility predicates (free only, accessibility, locals' picks,
 * off-peak, bring the dog). Extracted so they can run BEFORE the final
 * 50-result limit: applying them after the limit let 50 ineligible places
 * crowd out every eligible one beyond the cap (false scarcity).
 */
export function passesEligibility<T extends PlaceLike>(p: T, options: ApplyFiltersOptions): boolean {
  const { showFreeOnly, accessibilityMode, showLocalsPicks, showOffPeak, showDogs, isPremium } = options

  if (showFreeOnly) {
    // An explicit fee=yes is paid even for a park or viewpoint (a ticketed
    // garden, a tower). A missing fee stays — unknown is not "paid".
    const isFree = p.fee === 'yes'
      ? false
      : !p.fee || p.fee === 'no' || p.type?.includes('park') || p.type?.includes('viewpoint')
    if (!isFree) return false
  }

  if (accessibilityMode) {
    // The label promises accessible, so the predicate must match: only
    // confirmed step-free (wheelchair=yes). "limited" and missing are
    // not accessible.
    if (p.wheelchair !== 'yes') return false
  }

  // Premium: Locals' picks — independent, non-chain places. The scorer
  // already rewards tourism=attraction, so this must not veto it (a
  // famous historic pub is not a trap); the chain check shares the
  // scorer's isChainPlace helper so the two can't contradict.
  if (showLocalsPicks && isPremium) {
    if (p.brand || isChainPlace(p)) return false
    if (typeof p.qualityScore === 'number' && p.qualityScore < 30) return false
  }

  // Premium: Off-peak times — on the destination's local clock, not the
  // phone's, so a UK user planning an away weekend gets the right veto.
  if (showOffPeak && isPremium) {
    const { hour, day } = localTimeAt(p.lat, p.lng)
    const isWeekend = day === 0 || day === 6
    const type = p.type || ''

    if (type.includes('restaurant') || type.includes('cafe') || type.includes('fast_food') ||
        type.includes('biergarten') || type.includes('ice_cream') || type.includes('food_court')) {
      if ((hour >= 12 && hour < 15) || (hour >= 18 && hour < 21)) return false
    } else if (type.includes('park') || type.includes('garden') || type.includes('nature') ||
        type.includes('viewpoint') || type.includes('beach')) {
      if (isWeekend && hour >= 10 && hour < 17) return false
    } else if (type.includes('museum') || type.includes('attraction') || type.includes('castle') ||
        type.includes('gallery') || type.includes('zoo') || type.includes('aquarium')) {
      if (isWeekend && hour >= 11 && hour < 16) return false
    } else if (type.includes('pub') || type.includes('bar') || type.includes('nightclub')) {
      if (hour >= 17 && hour < 22) return false
    }
  }

  // Premium: Bring the dog — type-aware check (see dogCheck above). A
  // confirmed pass (explicit dog tag) sets dogFriendly; an inferred pass
  // (open green space, no dog tag) also sets dogInferred so the card can
  // show "usually dog-friendly" instead of the confirmed badge.
  if (showDogs && isPremium) {
    const check = dogCheck(p)
    if (!check.pass) return false
    p.dogFriendly = true
    p.dogInferred = check.inferred
  }

  return true
}

/**
 * Apply Discover's full filter pipeline:
 *
 *   1. Run the smart filter (category + score + diversity) via filterPlaces.
 *   2. Apply UI toggles: free only, accessibility, locals' picks
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
    showLocalsPicks,
    showOffPeak,
    isPremium,
    userProfile,
    weather,
    friendActivity,
    travelMode,
    selectedBand,
    includeClosed = false,
  } = options

  const hasActiveFilters =
    showFreeOnly ||
    accessibilityMode ||
    (showLocalsPicks && isPremium) ||
    (showOffPeak && isPremium) ||
    (options.showDogs && isPremium)

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
  if (!includeClosed) candidates = candidates.filter(p => !isClosedNow(p))

  // Eligibility predicates run BEFORE the final 50-result limit, so a deck of
  // high-ranked ineligible places can't crowd out every eligible one beyond
  // the cap (the old order produced false scarcity).
  const eligible = hasActiveFilters
    ? candidates.filter(p => passesEligibility(p, options))
    : candidates

  let filtered = filterPlaces(eligible as never, {
    categories: selectedCategories.length > 0 ? selectedCategories : null,
    minScore: 30,
    maxResults: 50,
    sortBy: 'smart',
    weather,
    ensureDiversity: true,
    userProfile,
    friendActivity,
  }) as T[]

  // Sort by quality score if locals picks is active
  if (showLocalsPicks && isPremium) {
    filtered.sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))
  }

  // Reorder the ranked deck nearest-first when the option is on. Layers on
  // top of the smart selector (nearest of the good places first), does not
  // replace it. Non-finite distances (null, undefined, or NaN from a place
  // with no coords) sort last; Number.isFinite catches all three where ??
  // only catches null/undefined. The da === db guard returns 0 when both are
  // non-finite so the sort no-ops cleanly instead of comparing
  // Infinity - Infinity = NaN (unspecified order).
  if (options.sortByDistance) {
    filtered.sort((a, b) => {
      const da = Number.isFinite(a.distance) ? a.distance : Infinity
      const db = Number.isFinite(b.distance) ? b.distance : Infinity
      return da === db ? 0 : da - db
    })
  }

  return filtered
}

/**
 * Google Places UI Kit support for place pages.
 *
 * Google's terms only let us show Places content next to our non-Google
 * (Leaflet) map through the UI Kit element <gmp-place-details-compact>, and
 * raw Places data must never be shown or stored by us. The one thing we are
 * allowed to keep is the place ID, which Google says may be cached forever.
 *
 * Matching uses Place.searchByText with fields ['id'] only, which bills to
 * "Text Search Essentials (IDs Only)" (SKU 635D-A9DD-C520, unlimited free).
 * The SKU is set by the field list alone; includedType and strict type
 * filtering are request parameters and don't change it. The card itself
 * bills to "Places UI Kit Query" per render.
 *
 * A wrong card is worse than none. With only ids we can't compare names for
 * free, so a match must come from: the name query, a strict Google type
 * where our OSM type maps cleanly, a box sized to the kind of place, and
 * exactly one result (two means Google isn't sure which, so we show none).
 */
import { isNative } from './nativeBridge'

const CACHE_KEY = 'roam_google_place_ids'
const MAX_ENTRIES = 500
const DAY_MS = 24 * 60 * 60 * 1000
const NO_MATCH_TTL_MS = 30 * DAY_MS
const MATCH_TTL_MS = 365 * DAY_MS

// OSM type -> Google Table A type, only where the meaning is the same.
// Broad types (tourist_attraction, historical_landmark) are left out: in
// testing they matched Warwick Castle to "Warwick Castle Trebuchet".
const GOOGLE_TYPE = {
  restaurant: 'restaurant', cafe: 'cafe', pub: 'pub', bar: 'bar',
  fast_food: 'fast_food_restaurant', ice_cream: 'ice_cream_shop',
  museum: 'museum', gallery: 'art_gallery', place_of_worship: 'church',
  castle: 'castle', park: 'park', garden: 'garden', zoo: 'zoo',
  aquarium: 'aquarium', theme_park: 'amusement_park', water_park: 'water_park',
  theatre: 'performing_arts_theater', cinema: 'movie_theater', library: 'library',
  nightclub: 'night_club', bowling_alley: 'bowling_alley', golf_course: 'golf_course',
  stadium: 'stadium', swimming_pool: 'swimming_pool', marina: 'marina',
  marketplace: 'market', planetarium: 'planetarium', beach: 'beach',
}

// Sites whose OSM point can sit far from Google's pin (centroid of a big area)
const LARGE = new Set(['park', 'garden', 'nature_reserve', 'common', 'recreation_ground',
  'golf_course', 'zoo', 'theme_park', 'water_park', 'beach', 'stadium', 'marina', 'wood'])
const MEDIUM = new Set(['museum', 'castle', 'place_of_worship', 'theatre', 'cinema',
  'library', 'gallery', 'aquarium', 'ruins', 'manor', 'marketplace'])

/** Search box half-size in metres for a ROAM place type. */
export function searchRadiusFor(type) {
  if (LARGE.has(type)) return 300
  if (MEDIUM.has(type)) return 150
  return 75
}

export function googleTypeFor(type) {
  return GOOGLE_TYPE[type] || null
}

// Session kill switch: after the key is refused (403, referrer not
// allowed, gm_authFailure) nothing else on this visit asks Google.
let sessionDisabled = false
export function disableGoogleCardForSession() { sessionDisabled = true }
export function isAuthFailure(err) {
  const msg = String(err?.message || err || '')
  return /403|PERMISSION_DENIED|REQUEST_DENIED|RefererNotAllowed|ApiNotActivated|InvalidKey|API key/i.test(msg)
}

export function googleMapsKey() {
  return import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY || ''
}

let loaderPromise = null

/**
 * Loads the Maps JS API once for the whole app and resolves with the
 * places library. A failed load clears the promise so a later place page
 * can try again (e.g. after coming back online).
 */
export function loadPlacesLibrary() {
  if (loaderPromise) return loaderPromise
  const key = googleMapsKey()
  if (!key || typeof document === 'undefined') return Promise.reject(new Error('Google Maps key missing'))

  loaderPromise = new Promise((resolve, reject) => {
    if (window.google?.maps?.importLibrary) {
      resolve()
      return
    }
    const callback = '__roamGoogleMapsReady'
    // Maps JS calls this global when the key is rejected for this site
    window.gm_authFailure = disableGoogleCardForSession
    window[callback] = () => { delete window[callback]; resolve() }
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=${callback}`
    script.async = true
    script.onerror = () => { script.remove(); reject(new Error('Google Maps script failed to load')) }
    document.head.appendChild(script)
  })
    .then(() => window.google.maps.importLibrary('places'))
    .catch((err) => { loaderPromise = null; throw err })
  return loaderPromise
}

/** A lat/lng box roughly `metres` either side of the point. */
export function boundsAround(lat, lng, metres) {
  const dLat = metres / 111320
  const dLng = metres / (111320 * Math.max(Math.cos(lat * Math.PI / 180), 0.01))
  return { north: lat + dLat, south: lat - dLat, east: lng + dLng, west: lng - dLng }
}

function readCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeCache(cache) {
  const keys = Object.keys(cache)
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => cache[a].t - cache[b].t)
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach(k => { delete cache[k] })
  }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)) } catch { /* storage full or blocked */ }
}

/**
 * Cached lookup: a Google place id string, null for a remembered "no match",
 * or undefined when we have to ask Google.
 */
export function cachedGooglePlaceId(roamId, now = Date.now()) {
  const entry = readCache()[String(roamId)]
  if (!entry) return undefined
  const age = now - entry.t
  if (entry.id) return age < MATCH_TTL_MS ? entry.id : undefined
  return age < NO_MATCH_TTL_MS ? null : undefined
}

/** Drop a cached id, e.g. when Google's element refuses it (gmp-error). */
export function forgetGooglePlaceId(roamId) {
  const cache = readCache()
  if (!(String(roamId) in cache)) return
  delete cache[String(roamId)]
  writeCache(cache)
}

export function rememberGooglePlaceId(roamId, googleId, now = Date.now()) {
  const cache = readCache()
  cache[String(roamId)] = { id: googleId || null, t: now }
  writeCache(cache)
}

/**
 * Whether a place page should try to show the Google card at all. Off in
 * the native apps until verified on a device: CapacitorHttp routes fetch/XHR
 * natively, so Google likely sees no referrer and refuses the key.
 */
const GENERIC_TYPES = new Set(['place', 'picnic_site', 'playground', 'artwork', 'memorial', 'bench', 'viewpoint'])

export function canShowGoogleCard(place) {
  if (sessionDisabled || isNative()) return false
  if (!place?.id || !place.name || place.name.trim().length < 3) return false
  if (place.type === 'event' || place.datetime?.start) return false
  // Generic names with no Google type ("Playground", "War Memorial") would
  // match whatever business is nearby: a wrong card is worse than none
  if (!googleTypeFor(place.type) && GENERIC_TYPES.has(place.type)) return false
  return place.lat != null && place.lng != null &&
    Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lng))
}

/**
 * Finds the Google place id for a ROAM place, or null when there is no
 * confident match: nothing called that within ~200m of our coordinates.
 * Network or API failures throw and are NOT cached, so they retry later.
 */
export async function findGooglePlaceId(place, { loadLibrary = loadPlacesLibrary } = {}) {
  const cached = cachedGooglePlaceId(place.id)
  if (cached !== undefined) return cached

  const { Place } = await loadLibrary()
  const lat = Number(place.lat)
  const lng = Number(place.lng)
  const includedType = googleTypeFor(place.type)
  // Name only: the box already pins the location, and a town name would
  // match every nearby address instead
  const request = {
    textQuery: place.name,
    fields: ['id'],
    locationRestriction: boundsAround(lat, lng, searchRadiusFor(place.type)),
    maxResultCount: 2,
  }
  if (includedType) Object.assign(request, { includedType, useStrictTypeFiltering: true })
  const { places } = await Place.searchByText(request)
  // Exactly one result or nothing: two means the name is ambiguous here
  const id = places?.length === 1 ? places[0].id || null : null
  rememberGooglePlaceId(place.id, id)
  return id
}

/**
 * GeoApify Places API client — dog-friendly merge for the Overpass proxy.
 *
 * ROAM's "bring the dog" filter reads the OSM dog=* tag, which is sparsely
 * mapped (the London 15 km gate fixture has 0 of 2,375 places tagged).
 * GeoApify builds on the same OSM data but indexes the dog conditions
 * (dogs.yes / dogs.leashed) as first-class query filters, so a circle
 * query with conditions returns dog-friendly places the raw OSM tags miss.
 *
 * The proxy (api/places/overpass/nearby.js) merges those places into the
 * Overpass answer as synthetic Overpass elements, so the client's existing
 * pipeline (parseOverpassResponse, enhancePlace, isDogFriendly) is untouched.
 *
 * Terms: GeoApify explicitly allows caching and storing results (no AUP-style
 * storage ban like Google's). Free tier 3,000 requests/day; the merge is one
 * request per dog-filtered Discover load, KV-cached 24 h.
 */

const GEOAPIFY_URL = 'https://api.geoapify.com/v2/places'

// Dog conditions we query — mirrors isDogFriendly() in
// src/pages/Discover/applyFilters.ts (yes, leashed; no-dogs is never).
// The Places API ANDs the conditions array (verified live: dogs.yes +
// dogs.leashed returns 0, a place can't be both), so each condition is its
// OWN request and the caller merges the results.
//
// ONLY dogs.yes (measured live, London 5km, 2026-09-30): dogs.yes answers
// in ~2.3s with 45 features; dogs.leashed takes 20s and returns 0 in the
// dog-condition-indexed category set. A leashed request would stall every
// cold-circle dog load for its timeout and never cache (empty answers are
// never cached), so it is not worth its own request. Leashed places tagged
// in raw OSM still flow through the Overpass path; re-add leashed here if
// its index yields data in a market we serve.
export const DOG_CONDITIONS = ['dogs.yes']

// ROAM category key -> GeoApify category keys.
//
// CRITICAL (verified live against the free tier, 2026-09-30): the dog
// condition is only indexed for SOME category keys, and adding a key that
// lacks it makes the WHOLE query return 0 — not just the extra key
// returning nothing. Compatible: catering, commercial, leisure (+
// leisure.park), natural, entertainment, man_made, pet. NOT indexed (poison
// the query): tourism, national_park, maritime, accommodation,
// production.*, education.library. Only compatible keys may appear here;
// an unindexed key zeroes the dog deck for its whole ROAM category.
const ROAM_TO_GEOAPIFY = {
  food: ['catering'],
  nature: ['leisure.park', 'natural'],
  culture: ['entertainment'],
  historic: ['memorial'],
  entertainment: ['entertainment'],
  nightlife: ['catering'],
  active: ['leisure', 'natural'],
  unique: ['entertainment'],
  shopping: ['commercial'],
  all: ['catering', 'commercial', 'leisure', 'natural', 'entertainment', 'man_made', 'pet'],
}

// GeoApify top-level group -> the OSM tag key the synthetic element gets.
// parseOverpassResponse derives the place type as
// amenity || tourism || leisure || historic || shop || natural || man_made || landuse,
// so these tag keys are the ones the client reads. Groups without a mapping
// (highway, power, parking, emergency, office, railway, service, religion) are
// never ROAM deck content and are dropped.
const CATEGORY_TO_OSM_TAG = {
  catering: 'amenity',
  commercial: 'shop',
  leisure: 'leisure',
  natural: 'natural',
  entertainment: 'amenity',
  tourism: 'tourism',
  man_made: 'man_made',
  heritage: 'historic',
  memorial: 'historic',
  accommodation: 'tourism',
  maritime: 'tourism',
  pet: 'leisure',
  national_park: 'leisure',
  production: 'amenity',
  education: 'amenity',
}

/**
 * Stable quantized cache key for a dog query: ~11 m grid on coordinates
 * (same scale the bbox snap uses) and 100 m on radius, so nearby users
 * share one GeoApify answer instead of paying per-GPS-jitter. PER
 * CONDITION: a timed-out condition (null) must not pin the other
 * condition's answer for 24 h, and a retried condition must not be
 * masked by a cached merge.
 */
export function dogCacheKey(lat, lng, radius, category, condition) {
  const l = Math.round(lat * 1e4) / 1e4
  const g = Math.round(lng * 1e4) / 1e4
  const r = Math.round(radius / 100) * 100
  return `geoapify:dogs:${l}:${g}:${r}:${category || 'all'}:${condition}`
}

/**
 * Convert one GeoApify feature into a synthetic Overpass element.
 * Returns null when the feature is not a place type ROAM deals (no mappable
 * category group, missing coordinates, or no dog condition matched).
 */
export function featureToElement(feature) {
  const props = feature?.properties || {}
  const cats = Array.isArray(props.categories) ? props.categories : []

  // The MOST SPECIFIC category key that maps to an OSM tag the client reads
  // identifies the place type. The live list leads with generic keys that
  // carry no deck value ('building', 'internet_access'...), so "first
  // non-dog key" dropped every real feature; the longest mappable key gives
  // the OSM-specific value ('catering.pub' -> amenity=pub).
  const mappable = cats
    .filter(c => typeof c === 'string' && !c.startsWith('dogs') && c !== 'no-dogs')
    .map(c => c.split('.'))
    .filter(parts => CATEGORY_TO_OSM_TAG[parts[0]])
    .sort((a, b) => b.length - a.length)
  const main = mappable[0]
  if (!main) return null

  const tagKey = CATEGORY_TO_OSM_TAG[main[0]]
  const value = main.slice(1).join('_') || main[0]

  // Which dog condition the place actually matched. A place matching both
  // is dog=yes (unrestricted beats leashed); leashed-only stays leashed so
  // isDogFriendly() keeps its existing semantics.
  let dog = null
  if (cats.includes('dogs.yes')) dog = 'yes'
  else if (cats.includes('dogs.leashed')) dog = 'leashed'
  else if (cats.includes('dogs')) dog = 'yes'
  if (!dog) return null

  const [lon, lat] = feature.geometry?.coordinates || []
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  // Nameless places can't be dealt (the client drops unnamed cards), so
  // they don't belong in the synthetic element set.
  if (!props.name) return null

  return {
    type: 'node',
    id: 'ga-' + (props.place_id || `${Math.round(lat * 1e6)}-${Math.round(lon * 1e6)}`),
    lat,
    lon,
    tags: {
      name: props.name || null,
      [tagKey]: value,
      dog,
    },
  }
}

/**
 * Merge GeoApify dog places into an Overpass element array.
 * Dedupes by ~11 m coordinate quantization (both sources are OSM: the same
 * pub can come back from both); the Overpass element wins because it carries
 * the full tag set.
 */
export function mergeDogPlaces(elements, dogPlaces) {
  if (!Array.isArray(dogPlaces) || dogPlaces.length === 0) return elements
  const coordKey = (lat, lon) => `${Math.round(lat * 1e4)}:${Math.round(lon * 1e4)}`
  const seen = new Set((elements || []).map(e => coordKey(e.lat, e.lon)))
  const added = []
  for (const el of dogPlaces) {
    const k = coordKey(el.lat, el.lon)
    if (seen.has(k)) continue
    seen.add(k)
    added.push(el)
  }
  return added.length ? [...elements, ...added] : elements
}

/**
 * Fetch dog-friendly places inside a circle from GeoApify.
 * Resolves to an array of synthetic Overpass elements. An empty answer
 * (0 features) resolves to [] and is NOT cacheable: the free tier
 * rate-limits bursts to a 200 with empty features, indistinguishable from a
 * genuine empty, so an empty must never pin "no dogs here" for 24h. A
 * failure (HTTP error, timeout, bad shape) resolves to null. Never throws.
 */
export async function fetchGeoApifyDogPlaces({ lat, lng, radius, category = null, apiKey, timeoutMs = 10000, condition = 'dogs.yes' }) {
  if (!apiKey) return []
  const categories = ROAM_TO_GEOAPIFY[category] || ROAM_TO_GEOAPIFY.all

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(GEOAPIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        categories,
        // ONE condition per request: the array is AND-ed server-side
        // (dogs.yes + dogs.leashed = 0 results, verified live).
        conditions: [condition],
        filter: { type: 'circle', lon: lng, lat, radius },
        // No bias: proximity sorting on the server tripled query time
        // (8.2s vs 2.4s, measured); the client sorts by distance itself
        // in enhancePlace.
        limit: 50,
      }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data || !Array.isArray(data.features)) return null
    return data.features.map(featureToElement).filter(Boolean)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * GeoApify dog-friendly places, merged into the Overpass proxy answer as
 * synthetic Overpass elements (OSM dog=* is sparse: 0 of 2,375 in the London
 * 15 km fixture). GeoApify allows caching; free tier 3,000 requests/day.
 */

const GEOAPIFY_URL = 'https://api.geoapify.com/v2/places'

// dogs.yes only: dogs.leashed measured 20 s / 0 features (London, 2026-09-30),
// and the conditions array is AND-ed, so both in one body returns 0.
//
// Only keys with the dog condition indexed: one unindexed key (tourism,
// national_park, maritime, accommodation, production.*, education.library)
// zeroes the whole query.
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

// GeoApify top-level group -> the OSM key parseOverpassResponse reads the type from
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

// ~11 m on coordinates, 100 m on radius, so nearby users share one answer
export function dogCacheKey(lat, lng, radius, category) {
  const l = Math.round(lat * 1e4) / 1e4
  const g = Math.round(lng * 1e4) / 1e4
  const r = Math.round(radius / 100) * 100
  return `geoapify:dogs:${l}:${g}:${r}:${category || 'all'}`
}

/** One GeoApify feature as a synthetic Overpass element, or null if ROAM can't deal it. */
export function featureToElement(feature) {
  const props = feature?.properties || {}
  const cats = Array.isArray(props.categories) ? props.categories : []
  if (!cats.includes('dogs.yes')) return null

  // The longest mappable key is the OSM-specific one ('catering.pub' -> amenity=pub);
  // the list leads with generic keys ('building', 'internet_access')
  const main = cats
    .filter(c => typeof c === 'string' && !c.startsWith('dogs') && c !== 'no-dogs')
    .map(c => c.split('.'))
    .filter(parts => CATEGORY_TO_OSM_TAG[parts[0]])
    .sort((a, b) => b.length - a.length)[0]
  if (!main) return null

  const [lon, lat] = feature.geometry?.coordinates || []
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  if (!props.name) return null

  return {
    type: 'node',
    id: 'ga-' + (props.place_id || `${Math.round(lat * 1e6)}-${Math.round(lon * 1e6)}`),
    lat,
    lon,
    tags: {
      name: props.name,
      [CATEGORY_TO_OSM_TAG[main[0]]]: main.slice(1).join('_') || main[0],
      dog: 'yes',
    },
  }
}

/** Append dog places not already in elements (~11 m dedupe; the Overpass element wins). */
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
 * Synthetic elements for dog-friendly places in a circle; null on failure, never throws.
 * [] is not cacheable: the free tier answers bursts with an empty 200.
 */
export async function fetchGeoApifyDogPlaces({ lat, lng, radius, category = null, apiKey, timeoutMs = 10000 }) {
  if (!apiKey) return []
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(GEOAPIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        categories: ROAM_TO_GEOAPIFY[category] || ROAM_TO_GEOAPIFY.all,
        conditions: ['dogs.yes'],
        filter: { type: 'circle', lon: lng, lat, radius },
        // no proximity bias: it tripled query time (8.2 s vs 2.4 s)
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

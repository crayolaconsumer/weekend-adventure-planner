/**
 * GeoApify dog-friendly places, merged into the Overpass proxy answer as
 * synthetic Overpass elements (OSM dog=* is sparse: 0 of 2,375 in the London
 * 15 km fixture). GeoApify allows caching; free tier 3,000 requests/day.
 */

import { trimOverpassResponse } from './overpassTrim.js'

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

// ── Worldwide places fallback ────────────────────────────────────────────────
// Outside the POI DB's region a cold tile used to wait on public Overpass (Sydney 53 s,
// Cape Town 503). nearby.js asks GeoApify in parallel and serves whichever answers first.
// GeoApify's places are OSM places and carry the OSM id and tags (datasource.raw, checked
// live 26 Oct 2026: Sydney cafes came back with osm_type "n", osm_id, amenity, opening_hours),
// so the answer is mapped back to Overpass elements: same ids for saves, swipes and
// /place/:id, same tags for the client's filters.

// OSM tag value the Discover query asks for -> the GeoApify category holding it. Values with
// no close category (recreation_ground, palace, waterfall...) are not asked for: the
// fallback deck is a subset of Overpass's, never a guess.
const TYPE_TO_GEOAPIFY = {
  restaurant: 'catering.restaurant', cafe: 'catering.cafe', bar: 'catering.bar', pub: 'catering.pub',
  fast_food: 'catering.fast_food', biergarten: 'catering.biergarten', ice_cream: 'catering.ice_cream',
  food_court: 'catering.food_court',
  bakery: 'commercial.food_and_drink.bakery', butcher: 'commercial.food_and_drink.butcher',
  cheese: 'commercial.food_and_drink.cheese_and_dairy', dairy: 'commercial.food_and_drink.cheese_and_dairy',
  chocolate: 'commercial.food_and_drink.chocolate', confectionery: 'commercial.food_and_drink.confectionery',
  deli: 'commercial.food_and_drink.deli', farm: 'commercial.food_and_drink.farm',
  greengrocer: 'commercial.food_and_drink.fruit_and_vegetable', seafood: 'commercial.food_and_drink.seafood',
  tea: 'commercial.food_and_drink.coffee_and_tea', coffee: 'commercial.food_and_drink.coffee_and_tea',
  wine: 'commercial.food_and_drink.drinks', pasta: 'commercial.food_and_drink.pasta',
  spices: 'commercial.food_and_drink.spices', health_food: 'commercial.food_and_drink.health_food',
  park: 'leisure.park', garden: 'leisure.park.garden', nature_reserve: 'leisure.park.nature_reserve',
  dog_park: 'pet.dog_park', viewpoint: 'tourism.attraction.viewpoint', picnic_site: 'leisure.picnic.picnic_site',
  beach: 'beach', peak: 'natural.mountain.peak', cliff: 'natural.mountain.cliff',
  cave_entrance: 'natural.mountain.cave_entrance', volcano: 'natural.mountain.volcano',
  spring: 'natural.water.spring', hot_spring: 'natural.water.hot_spring', geyser: 'natural.water.geyser',
  bay: 'natural.water.bay', heath: 'natural.heath_moor', moor: 'natural.heath_moor',
  wood: 'natural.forest', forest: 'natural.forest', water: 'natural.water',
  place_of_worship: 'religion.place_of_worship', // town pages: amenity=place_of_worship
  theatre: 'entertainment.culture.theatre', arts_centre: 'entertainment.culture.arts_centre',
  gallery: 'entertainment.culture.gallery', museum: 'entertainment.museum', cinema: 'entertainment.cinema',
  planetarium: 'entertainment.planetarium', library: 'education.library',
  community_centre: 'activity.community_center', events_venue: 'activity.events_venue',
  castle: 'tourism.sights.castle', manor: 'tourism.sights.manor', ruins: 'tourism.sights.ruines',
  memorial: 'tourism.sights.memorial', monument: 'tourism.sights.memorial.monument',
  tomb: 'tourism.sights.memorial.tomb', wayside_cross: 'tourism.sights.memorial.wayside_cross',
  milestone: 'tourism.sights.memorial.milestone', aircraft: 'tourism.sights.memorial.aircraft',
  archaeological_site: 'tourism.sights.archaeological_site', fort: 'tourism.sights.fort',
  city_gate: 'tourism.sights.city_gate', mine: 'tourism.sights.mine', mine_shaft: 'tourism.sights.mine',
  battlefield: 'tourism.sights.battlefield', wreck: 'tourism.sights.wreck',
  monastery: 'tourism.sights.monastery', church: 'tourism.sights.place_of_worship.church',
  temple: 'tourism.sights.place_of_worship.temple', heritage: 'heritage', grave_yard: 'memorial.graveyard',
  zoo: 'entertainment.zoo', aquarium: 'entertainment.aquarium', theme_park: 'entertainment.theme_park',
  water_park: 'entertainment.water_park', bowling_alley: 'entertainment.bowling_alley',
  miniature_golf: 'entertainment.miniature_golf', amusement_arcade: 'entertainment.amusement_arcade',
  escape_game: 'entertainment.escape_game', trampoline_park: 'entertainment.activity_park.trampoline',
  ice_rink: 'sport.ice_rink', horse_riding: 'sport.horse_riding', sauna: 'leisure.spa.sauna',
  adult_gaming_centre: 'adult.adult_gaming_centre', casino: 'adult.casino', nightclub: 'adult.nightclub',
  sports_centre: 'sport.sports_centre', sports_hall: 'sport.sports_hall', swimming_pool: 'sport.swimming_pool',
  pitch: 'sport.pitch', track: 'sport.track', golf_course: 'sport.golf_course',
  fitness_centre: 'sport.fitness.fitness_centre', fitness_station: 'sport.fitness.fitness_station',
  stadium: 'sport.stadium', fishing: 'sport.fishing', marina: 'maritime.marina', beach_resort: 'beach.beach_resort',
  // A parent category returns all its children: tourism.attraction is mostly artwork (36 of
  // Sydney's first 40, 26 Oct), so it is asked for only by decks that want artwork too
  artwork: 'tourism.attraction', fountain: 'tourism.attraction.fountain',
  lighthouse: 'man_made.lighthouse', windmill: 'man_made.windmill', water_tower: 'man_made.water_tower',
  tower: 'man_made.tower', bridge: 'man_made.bridge', pier: 'man_made.pier',
  marketplace: 'commercial.marketplace', mall: 'commercial.shopping_mall', antiques: 'commercial.antiques',
  art: 'commercial.art', bag: 'commercial.bag', books: 'commercial.books', boutique: 'commercial.clothing',
  clothes: 'commercial.clothing.clothes', shoes: 'commercial.clothing.shoes',
  charity: 'commercial.second_hand', second_hand: 'commercial.second_hand', florist: 'commercial.florist',
  collector: 'commercial.hobby.collecting', model: 'commercial.hobby.model', anime: 'commercial.hobby.anime',
  musical_instrument: 'commercial.hobby.music', photo: 'commercial.hobby.photo', camera: 'commercial.hobby.photo',
  furniture: 'commercial.furniture_and_interior', kitchen: 'commercial.furniture_and_interior.kitchen',
  lighting: 'commercial.furniture_and_interior.lighting', houseware: 'commercial.houseware_and_hardware',
  games: 'commercial.toy_and_game', toys: 'commercial.toy_and_game', gift: 'commercial.gift_and_souvenir',
  jewelry: 'commercial.jewelry', music: 'commercial.video_and_music', outdoor: 'commercial.outdoor_and_sport',
  sports: 'commercial.outdoor_and_sport', bicycle: 'commercial.outdoor_and_sport.bicycle',
  perfumery: 'commercial.health_and_beauty.cosmetics', stationery: 'commercial.stationery',
  watches: 'commercial.watches',
}

// Three requests in parallel (food and shops, outdoors, sights), so a city centre's hundreds
// of cafes and parks can't fill the deck: with two, Sydney's 5 km deck came back with 29 parks,
// 1 attraction and no museum (26 Oct). GeoApify bills 1 credit per 20 places returned.
const GROUP_OF = { catering: 0, commercial: 0, leisure: 1, natural: 1, beach: 1, pet: 1, sport: 1, maritime: 1 }
export const GEOAPIFY_PLACES_LIMIT = 40 // per request: <= 2 credits each, 6 per fallback
const OSM_TYPES = { n: 'node', w: 'way', r: 'relation', node: 'node', way: 'way', relation: 'relation' }

/** The `[bbox:s,w,n,e]` of an Overpass query as numbers, or null. */
export function queryBbox(query) {
  const m = /\[bbox:\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/.exec(query || '')
  if (!m) return null
  const [s, w, n, e] = m.slice(1).map(Number)
  return [s, w, n, e].every(Number.isFinite) && s < n && w < e ? { s, w, n, e } : null
}

/** The `["key"~"^(a|b)$"]` and `["key"="value"]` filters of an Overpass query: { key: Set(values) }. */
export function requestedTags(query) {
  const tags = {}
  const q = String(query || '')
  for (const [, key, values] of q.matchAll(/\["([a-z_:]+)"~"\^\(([^()"]*)\)\$"\]/g)) {
    for (const v of values.split('|')) (tags[key] ??= new Set()).add(v)
  }
  for (const [, key, value] of q.matchAll(/\["([a-z_:]+)"="([^"]*)"\]/g)) (tags[key] ??= new Set()).add(value)
  return tags
}

/** GeoApify categories for the requested tags, split into [food+shops, outdoors, sights]. */
export function geoapifyCategories(tags) {
  const groups = [new Set(), new Set(), new Set()]
  for (const values of Object.values(tags)) {
    for (const v of values) {
      const cat = TYPE_TO_GEOAPIFY[v]
      if (cat) groups[GROUP_OF[cat.split('.')[0]] ?? 2].add(cat)
    }
  }
  return groups.map(g => [...g]).filter(g => g.length > 0)
}

/**
 * One GeoApify feature as the Overpass element the same OSM object would be, or null.
 * Dropped: places without an OSM id (non-OSM sources: their ids would collide with OSM ids
 * in saves and /place/:id), unnamed ones (the client drops them anyway), and any whose raw
 * OSM tags don't match a filter the query asked for (GeoApify's categories are broader).
 */
export function placeToElement(feature, tags) {
  const props = feature?.properties || {}
  const raw = props.datasource?.raw
  if (!raw || typeof raw !== 'object') return null
  const type = OSM_TYPES[raw.osm_type]
  // Relations can come back negative (the osm2pgsql convention); nodes and ways never do
  const id = type === 'relation' ? Math.abs(Number(raw.osm_id)) : Number(raw.osm_id)
  if (!type || !Number.isSafeInteger(id) || id <= 0) return null
  const lat = props.lat ?? feature.geometry?.coordinates?.[1]
  const lon = props.lon ?? feature.geometry?.coordinates?.[0]
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const osmTags = {}
  for (const [k, v] of Object.entries(raw)) {
    if (k !== 'osm_id' && k !== 'osm_type' && k !== 'lat' && k !== 'lon' && (typeof v === 'string' || typeof v === 'number')) osmTags[k] = String(v)
  }
  if (!osmTags.name && !osmTags['name:en']) return null
  if (!Object.entries(tags).some(([k, values]) => values.has(osmTags[k]))) return null
  // Overpass `out tags center`: nodes carry lat/lon, ways and relations a center
  return type === 'node' ? { type, id, lat, lon, tags: osmTags } : { type, id, center: { lat, lon }, tags: osmTags }
}

/**
 * True for an area query GeoApify can stand in for, with tag filters it maps to categories:
 * the Discover deck (shared/overpassQuery.js) and the town page (api/lib/towns.js). Id lookups
 * (`node(123)`) never. For a town page the stand-in is approximate, and says so: ["wikidata"]
 * is not enforced (town.js ranks wikidata places first anyway, so unlinked ones sink rather
 * than vanish), the per-statement `bb N` limits become 40 per category group, and there are
 * no `bounds`, so parks are not ranked by size. town.js caches such a page for 10 min only.
 */
export function geoapifyCanAnswer(query) {
  const q = String(query || '')
  if (!queryBbox(q) || /\b(node|way|relation)\(\d/.test(q)) return false
  return geoapifyCategories(requestedTags(q)).length > 0
}

/**
 * Discover places for an Overpass query from GeoApify, as an Overpass body ({ elements }).
 * Resolves { data, credits } (data null when GeoApify can't answer); never throws.
 */
export async function fetchGeoapifyPlaces(query, { apiKey, timeoutMs = 2500 } = {}) {
  if (!apiKey || !geoapifyCanAnswer(query)) return { data: null, credits: 0 }
  const bbox = queryBbox(query)
  const tags = requestedTags(query)
  const groups = geoapifyCategories(tags)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const answers = await Promise.all(groups.map(categories => fetch(GEOAPIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        categories,
        // The bbox as a polygon: the documented POST filter shape (docs show no POST rect)
        filter: { type: 'polygon', geometry: { type: 'Polygon', coordinates: [[[bbox.w, bbox.s], [bbox.e, bbox.s], [bbox.e, bbox.n], [bbox.w, bbox.n], [bbox.w, bbox.s]]] } },
        limit: GEOAPIFY_PLACES_LIMIT,
      }),
      signal: controller.signal,
    }).then(async res => {
      // Billing, on the safe side of the budget: an answer costs 1 credit per 20 places and at
      // least 1 even when empty; a 4xx was refused (0); a 5xx, an abort or a dropped connection
      // may have been processed, so it is charged the request's worst case
      const worst = Math.ceil(GEOAPIFY_PLACES_LIMIT / 20)
      if (!res.ok) return { features: null, credits: res.status >= 500 ? worst : 0 }
      const features = (await res.json().catch(() => null))?.features
      return { features: Array.isArray(features) ? features : null, credits: Array.isArray(features) ? Math.max(1, Math.ceil(features.length / 20)) : worst }
    }).catch(() => ({ features: null, credits: Math.ceil(GEOAPIFY_PLACES_LIMIT / 20) }))))
    const credits = answers.reduce((sum, a) => sum + a.credits, 0)
    const seen = new Set()
    const elements = []
    for (const el of answers.flatMap(a => a.features || []).map(f => placeToElement(f, tags))) {
      if (!el || seen.has(`${el.type}/${el.id}`)) continue
      seen.add(`${el.type}/${el.id}`)
      elements.push(el)
    }
    // generator marks the body as a stand-in (Overpass bodies carry their own generator): town.js
    // gives such a page a short cache. Trimmed like an Overpass answer (api/lib/overpassTrim.js)
    return { data: elements.length ? trimOverpassResponse({ generator: 'geoapify', elements }) : null, credits }
  } finally {
    clearTimeout(timer)
  }
}

// Daily credit budget: a hard ceiling (the free tier is 3,000 credits/day and ROAM is
// pre-revenue; nothing may run up charges). Every GeoApify call reserves its WORST-CASE cost
// first with one atomic INCRBY, so concurrent requests can't all pass a check and then spend;
// a reservation that lands over its cap is rolled back and the call is not made. After the
// call the unused part is refunded. A request that was aborted or timed out keeps its whole
// reservation: GeoApify most likely processed and billed it.
//
// Two caps on one counter: the places and town-page fallbacks stop at 2,400, dog mode (a paid
// feature) may use up to 2,800, so the fallbacks can never starve it of the last 400.
// KV unavailable: no reservation, no call (fails closed). Cold tiles then wait on Overpass
// as before, and dog mode deals without its GeoApify extras.
export const GEOAPIFY_DAILY_CREDIT_CAP = 2800
export const GEOAPIFY_FALLBACK_CREDIT_CAP = 2400
export const GEOAPIFY_DOG_CREDITS = 3 // fetchGeoApifyDogPlaces: limit 50 = up to 3 credits
const creditKey = (now = new Date()) => `geoapify:credits:${now.toISOString().slice(0, 10)}`

/** Worst-case credits of fetchGeoapifyPlaces for this query (0: it won't call). */
export function geoapifyPlacesWorstCase(query) {
  return geoapifyCanAnswer(query) ? geoapifyCategories(requestedTags(query)).length * Math.ceil(GEOAPIFY_PLACES_LIMIT / 20) : 0
}

/**
 * Reserve `credits` under `cap`. Resolves { key, credits, total } or null (over the cap, or
 * KV can't count). The key is kept so a refund after midnight lands on the day it was spent.
 */
export async function reserveGeoapifyCredits(client, credits, cap) {
  return reserveCounter(client, creditKey(), credits, cap)
}

// Per-IP daily allowance of GeoApify fallbacks (places and town pages), on top of the global
// cap: without it one client POSTing arbitrary bboxes could spend the whole day's 2,400 in a
// few minutes and switch the fallback off for everyone (critic P1b: 50 tiles = 150 credits).
// Counted in fallbacks, not credits. Same fail-closed rule as the budget.
// Dog mode (a paid feature) has its own allowance, counted in dog calls: without it one IP
// varying lat spent 3 credits a request and drained the shared 2,400 in ~33 min (critic P1).
export const GEOAPIFY_FALLBACKS_PER_IP = 30
export const GEOAPIFY_DOG_CALLS_PER_IP = 40
export async function reserveGeoapifyForIp(client, ip, kind = 'places') {
  const bucket = allowanceBucket(ip)
  if (!bucket) return null
  const cap = kind === 'dogs' ? GEOAPIFY_DOG_CALLS_PER_IP : GEOAPIFY_FALLBACKS_PER_IP
  const prefix = kind === 'dogs' ? 'geoapify:ipdogs' : 'geoapify:ip'
  return reserveCounter(client, `${prefix}:${new Date().toISOString().slice(0, 10)}:${bucket}`, 1, cap)
}

/**
 * The allowance key for an address: IPv4 as is, IPv6 by its /64 (one customer's prefix: a
 * client rotating addresses inside it would otherwise get a fresh allowance per address).
 * IPv4-mapped IPv6 (::ffff:1.2.3.4) counts as the IPv4. Unparseable: null (no allowance).
 */
export function allowanceBucket(ip) {
  const a = String(ip || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) return a
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a)
  if (mapped) return mapped[1]
  if (!a.includes(':') || !/^[0-9a-f:]+$/.test(a) || (a.match(/::/g) || []).length > 1) return null
  const [head, tail = null] = a.split('::')
  const left = head ? head.split(':') : []
  const right = tail === null ? [] : tail ? tail.split(':') : []
  const missing = 8 - left.length - right.length
  if (tail === null ? missing !== 0 : missing < 1) return null
  const groups = [...left, ...Array(tail === null ? 0 : missing).fill('0'), ...right]
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return `${groups.slice(0, 4).map(g => parseInt(g, 16).toString(16)).join(':')}::/64`
}

const COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60

// INCRBY then check: atomic, so concurrent callers can't all pass. Over the cap: rolled back, null.
async function reserveCounter(client, key, credits, cap) {
  if (!client || !(credits > 0)) return null
  let total
  try {
    total = Number(await client.incrby(key, credits))
  } catch {
    return null
  }
  if (!Number.isFinite(total) || total > cap) {
    try { await client.decrby(key, credits) } catch { /* the day's count stays high: safe side */ }
    return null
  }
  // Awaited, and on every reservation: a TTL dropped once is set again by the next one, so a
  // per-day key can't outlive its day for long. 2 days covers a refund landing after midnight
  try {
    await client.expire(key, COUNTER_TTL_SECONDS)
  } catch {
    // the next reservation sets it
  }
  return { key, credits, total }
}

/** Give back what a reserved call didn't spend, or charge what it spent beyond the reservation. */
export async function settleGeoapifyCredits(client, reservation, spent) {
  const unused = reservation ? reservation.credits - Math.max(0, spent) : 0
  try {
    if (unused > 0) await client.decrby(reservation.key, unused)
    // GeoApify returning more than `limit` (it shouldn't): the count must still be true
    else if (unused < 0) await client.incrby(reservation.key, -unused)
  } catch {
    // a lost refund only makes the cap sooner; a lost overage is at most a few credits
  }
}

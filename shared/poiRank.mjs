/**
 * Relevance cap for dense Discover answers: ONE definition shared by the POI
 * build (scripts/poi/build.mjs writes the features), the loader
 * (api/admin/poi-load.js re-derives and checks them) and the server
 * (api/lib/poiQuery.js ranks with them).
 *
 * poiFeatures(el) turns a stored Overpass element into three small numbers
 * (pois.q, pois.cat, pois.flags). rankCap(rows, center, cap) keeps the <= cap
 * rows the phone's deck picker would deal from, reading only those numbers and
 * each row's bounds, so the server never has to fetch `el` for the rest.
 *
 * Why these rows: the deck picker (src/utils/placeFilter.js selectWithDiversity)
 * round-robins categories, and inside a category round-robins ~500 m zones,
 * each zone led by its best place by deckRank = score + nearness + open-now +
 * jitter. So the deck is the leaders of the best zones of each category. We
 * keep, in order:
 *   1. the farthest deck-eligible place of every category (pins the client's
 *      nearness scale, maxDistance, for the unfiltered and filtered decks);
 *   2. per (category x distance ring) stratum, its best min(size, 25) places,
 *      so client-side category / distance-band filters still have supply;
 *   3. the rest by rank minus 3 points per better place in the same zone
 *      (open-now and seeded jitter, ~35 points the server can't see, pick the
 *      real leader), ranked once per time of day using a rough read of
 *      opening_hours, categories taking weighted turns.
 * Pure and deterministic: ties break on row position, output keeps row order.
 * Winner of a blind eval (tests/evals/rankCap.eval.js, rubric
 * /tmp/roam-overnight/ranking/RUBRIC.md) as "variant A".
 *
 * The client functions ported here are pinned by tests/unit/poi/poiRank.test.js
 * (categories.ts, placeFilter.js scorePlace / filterPlaces, badges.js
 * isChainPlace): a change on either side fails CI.
 */
import { GOOD_CATEGORY_TYPES } from './overpassQuery.js'
import { haversineKm } from './geo.mjs'

/**
 * Version of the q / cat / flags features below. A build carries it in its
 * manifest (features_version) and the loader copies it into the build's
 * gate_report; the server caps only a build whose version equals this one.
 * Any other build (none: pre-feature builds, or a future version this code
 * can't read) is served exactly as before, uncapped. Bump it whenever
 * poiFeatures changes what it writes.
 */
export const FEATURES_VERSION = 1

/**
 * Rows a capped Discover answer keeps (api/lib/poiQuery.js serves it; the eval judges it).
 * 3,500, not the rubric's first 3,000: at 3,000 the positional eval (every phone in the
 * snap cell) dealt London 15 km food at 0.89; 3,500 gives 0.93 there, in bodies of at most
 * ~1.33 MB (the rubric's budget is 1.5 MB; 3,800 measured no better). Measured on the
 * London fixtures only (in sample), 2026-09-28.
 */
export const CAP = 3500

// ---- The phone's deck constants (pinned to their client source by tests/unit/poi/poiRank.test.js) ----
export const MIN_SCORE = 25 // Discover.jsx filterPlaces minScore
export const CHAIN_PENALTY = 30 // badges.js CHAIN_PENALTY
export const ZONE_DEG = 0.005 // placeFilter.js getGeoZone precision (~500 m)
export const NEAREST = 20 // placeFilter.js DECK_WEIGHTS.nearest
export const OPEN_NOW = 8 // DECK_WEIGHTS.openNow
export const CLOSED_NOW = -15 // DECK_WEIGHTS.closedNow

// ---- Ports of src/utils/categories.ts, badges.js, placeFilter.js scorePlaceBase ----

/** pois.cat: 0 = no category ('other'), else 1 + index in GOOD_CATEGORY_TYPES. */
export const CATEGORY_KEYS = Object.keys(GOOD_CATEGORY_TYPES)
const CATEGORY_CODE = new Map()
for (const [n, types] of Object.values(GOOD_CATEGORY_TYPES).entries()) {
  for (const t of types) if (!CATEGORY_CODE.has(t)) CATEGORY_CODE.set(t, n + 1) // first category wins, as getCategoryForType
}
export const categoryCode = (type) => CATEGORY_CODE.get(type) || 0

export const BLACKLIST = ['health', 'clinic', 'hospital', 'pharmacy', 'dentist', 'doctor', 'optician', 'veterinary', 'medical',
  'nursing_home', 'hospice', 'chemist', 'bank', 'atm', 'post_office', 'money_transfer', 'bureau_de_change', 'pawnbroker',
  'money_lender', 'bookmaker', 'lottery', 'police', 'fire_station', 'courthouse', 'government', 'townhall', 'embassy',
  'consulate', 'prison', 'military', 'school', 'college', 'kindergarten', 'university', 'driving_school', 'childcare',
  'fuel', 'car_wash', 'car_repair', 'car_parts', 'parking', 'garage', 'car_rental', 'bus_station', 'taxi', 'car_sharing',
  'charging_station', 'motorcycle_parking', 'bicycle_parking', 'bicycle_rental', 'parcel_locker', 'ferry_terminal',
  'tyres', 'car', 'motorcycle', 'caravan', 'trailer', 'truck', 'scooter', 'toilet', 'waste_basket', 'recycling',
  'waste_disposal', 'manhole', 'telephone', 'post_box', 'bench', 'shelter', 'parking_space', 'parking_entrance',
  'vending_machine', 'street_cabinet', 'utility_pole', 'political', 'place_of_worship', 'convent', 'industrial',
  'warehouse', 'storage', 'storage_rental', 'factory', 'office', 'works', 'silo', 'supermarket', 'convenience',
  'department_store', 'wholesale', 'hardware', 'electronics', 'mobile_phone', 'computer', 'kiosk', 'variety_store',
  'vacant', 'outpost', 'doityourself', 'appliance', 'electrical', 'paint', 'tiles', 'flooring', 'bathroom_furnishing',
  'glaziery', 'trade', 'agrarian', 'hairdresser', 'beauty', 'cosmetics', 'tobacco', 'massage', 'laundry',
  'dry_cleaning', 'tailor', 'shoe_repair', 'locksmith', 'copyshop', 'estate_agent', 'insurance', 'lawyer',
  'travel_agency', 'funeral_directors', 'pet', 'community_hall', 'conservative_club', 'working_mens_club', 'youth_club']
const blacklistCache = new Map()
/** categories.ts isBlacklisted: substring match on the type. */
export function isBlacklisted(type) {
  if (!type) return false
  if (!blacklistCache.has(type)) blacklistCache.set(type, BLACKLIST.some(b => type.toLowerCase().includes(b)))
  return blacklistCache.get(type)
}

// categories.ts BORING_NAME_PATTERNS (there with the i flag), tested as one regex
export const BORING_PATTERNS = [
  /health\s*cent(er|re)/, /medical/, /surgery/, /dental/, /pharmacy/, /car\s*park/, /parking/, /petrol/, /garage/,
  /toilet/, /wc\b/, /post\s*office/, /bank\b/, /atm\b/, /school/, /college\b/, /council/, /\boffice\b/, /industrial/,
  /warehouse/, /depot/, /conservative\s*club/, /working\s*men/, /social\s*club/, /community\s*cent(er|re)/,
  /\btesco\b/, /sainsbury/, /\basda\b/, /\blidl\b/, /\baldi\b/, /morrisons/, /co-?op\b/, /\biceland\b/, /waitrose/,
  /budgens/, /sports\s*direct/, /\bargos\b/, /halfords/, /\bcurrys\b/, /poundland/, /pound\s*world/, /\bb\s*&\s*m\b/,
  /\bwilko\b/, /home\s*bargains/, /the\s*works/, /\bryman\b/, /\bwhsmith\b/, /\bboots\b/, /superdrug/, /\bwetherspoon/,
  /\bh\s*&\s*m\b/, /primark/, /\bzara\b/, /\bnext\b\s*(plc|store)?/, /\bm\s*&\s*s\b/, /marks\s*&\s*spencer/, /\bgap\b/,
  /uniqlo/, /\bc\s*&\s*a\b/, /forever\s*21/, /walmart/, /\btarget\b/, /\bcostco\b/, /\bikea\b/, /\bdollar\s*tree/,
  /carrefour/, /\bauchan\b/, /\bedeka\b/, /\brewe\b/, /\bnetto\b/, /\bshell\b/, /\bbp\b/, /\besso\b/, /texaco/,
  /\bexxon/, /\bchevron/,
]
const BORING = new RegExp(BORING_PATTERNS.map(r => `(?:${r.source})`).join('|'), 'i')
/** categories.ts hasBoringName. */
export const hasBoringName = (name) => Boolean(name) && BORING.test(name)

export const KNOWN_CHAINS = ['starbucks', 'costa', 'costa coffee', 'caffe nero', 'pret', 'pret a manger', 'greggs', 'nero',
  'coffee#1', 'caffe ritazza', 'caffè nero', 'mcdonald\'s', 'mcdonalds', 'burger king', 'kfc', 'subway', 'domino\'s',
  'dominos', 'pizza hut', 'papa john\'s', 'papa johns', 'five guys', 'nando\'s', 'nandos', 'wagamama', 'wahaca', 'itsu',
  'wasabi', 'yo sushi', 'leon', 'tortilla', 'chipotle', 'wetherspoons', 'wetherspoon', 'j d wetherspoon', 'greene king',
  'marstons', 'marston\'s', 'mitchells & butlers', 'harvester', 'beefeater', 'brewers fayre', 'toby carvery',
  'hungry horse', 'stonehouse', 'miller & carter', 'all bar one', 'slug and lettuce', 'revolution', 'walkabout',
  'o\'neills', 'yates', 'be at one', 'pizza express', 'zizzi', 'ask italian', 'bella italia', 'prezzo',
  'frankie & benny\'s', 'chiquito', 'tgi fridays', 'las iguanas', 'tesco', 'sainsbury\'s', 'sainsburys', 'asda',
  'morrisons', 'lidl', 'aldi', 'waitrose', 'marks & spencer', 'm&s', 'co-op', 'coop', 'spar', 'nisa', 'londis',
  'premier', 'one stop', 'costcutter', 'budgens', 'boots', 'superdrug', 'holland & barrett', 'savers', 'wh smith',
  'whsmith', 'smiths', 'premier inn', 'travelodge', 'holiday inn', 'ibis', 'novotel', 'hilton', 'marriott',
  'best western', 'doubletree']
// name equals a chain or starts with "<chain> " (badges.js isChainPlace), as one regex
const CHAIN_NAME = new RegExp(`^(?:${KNOWN_CHAINS.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?: |$)`)
const ATTRACTION_TOURISM = new Set(['attraction', 'museum', 'theme_park', 'zoo', 'aquarium', 'gallery'])
const FOOD_OR_RETAIL = new Set(['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court', 'ice_cream'])
/** badges.js isChainPlace on a parsed place (parsed places carry no `shop`). */
export function isChain(t, type, name) {
  if (ATTRACTION_TOURISM.has(t.tourism || type) && !FOOD_OR_RETAIL.has(type)) return false
  if (t.brand || t['brand:wikidata']) return true
  return CHAIN_NAME.test(name.toLowerCase().trim())
}

const PREMIUM = new Set(['museum', 'gallery', 'theatre', 'planetarium', 'music_venue', 'exhibition_centre', 'castle',
  'manor', 'archaeological_site', 'fort', 'monument', 'ruins', 'temple', 'zoo', 'aquarium', 'theme_park', 'escape_game',
  'water_park', 'viewpoint', 'lighthouse', 'windmill', 'attraction', 'artwork', 'beach', 'nature_reserve', 'peak',
  'hot_spring', 'geyser', 'volcano'])
const INTERESTING = /the\s|old\s|royal|ancient|historic|manor|hall|house|arms|inn|lodge/i
const TOURISM_BONUS = { attraction: 10, museum: 12, viewpoint: 8, theme_park: 10 }

/** placeFilter.js scorePlaceBase with no context boosts, before its 0-100 clamp. */
export function rawScore(t, type, name) {
  let s = categoryCode(type) ? 35 : 0
  if (t.image) s += 12
  if (t.website || t['contact:website']) s += 6
  if (t.opening_hours) s += 6
  const desc = t.description || t['description:en']
  if (desc && desc.length > 20) s += 8
  if (t.wikipedia || t.wikidata) s += 10
  if (t.phone || t['contact:phone']) s += 3
  if (t['addr:housenumber'] || t['addr:street'] || t['addr:city'] || t['addr:postcode']) s += 3
  if (isBlacklisted(type)) s -= 100
  if (hasBoringName(name)) s -= 50
  if (PREMIUM.has(type)) s += 12
  s += TOURISM_BONUS[t.tourism] || 0
  if (t.heritage || t.designation) s += 12
  if (t.fee === 'yes') s += 5
  if (t.image || t.wikimedia_commons) s += 6
  if (INTERESTING.test(name)) s += 4
  return s
}

// ---- Opening hours: bit k of flags = open at SLOTS[k] (local hours) ----
// Open-now moves a place with opening_hours +8 (open) or -15 (closed) on the phone. The server has no
// clock (the body must be cacheable), so it ranks once per time of day, with a rough reading of the
// hours: open if any time range covers that time, whatever the day.
export const SLOTS = [3, 8, 12.5, 19, 23.5]
const HOUR = { sunrise: 7, dawn: 7, sunset: 18.5, dusk: 18.5 } // rough, it only picks a ranking pass
const toHour = (x) => HOUR[x] ?? (x ? +x.slice(0, -3) + x.slice(-2) / 60 : 26) // "HH:MM+" = open late
export function openSlots(hours) {
  if (hours.includes('24/7')) return (1 << SLOTS.length) - 1
  let bits = 0
  for (const [, a, b] of hours.matchAll(/(\d\d?:\d\d|sunrise|dawn)\s*(?:-\s*\(?(\d\d?:\d\d|sunset|dusk)|\+)/g)) {
    const start = toHour(a)
    let end = toHour(b)
    if (end <= start) end += 24
    SLOTS.forEach((t, k) => { if ((start <= t && t < end) || (start <= t + 24 && t + 24 < end)) bits |= 1 << k })
  }
  return bits
}

// ---- pois.flags bit layout (one TINYINT: the covering index has no room for more columns) ----
export const OPEN_MASK = (1 << SLOTS.length) - 1 // bits 0-4: open at SLOTS[k]
export const HAS_HOURS = 1 << 5 // opening_hours present (else the phone adds nothing either way)
export const ELIGIBLE = 1 << 6 // passes the deck's filters (Discover.jsx minScore 25, access, blacklist, boring name)
export const SKIP = 1 << 7 // the phone drops it on parse (no coordinates or name): never kept

// The client adds a per-category boost, then clamps at 100: time of day (0-20), weather (0-12),
// +20 for the category the user filtered to. Within a category it only acts through the clamp
// (more boost, more places tie at 100 and nearness decides). 25 won a sweep of 0-50.
export const BOOST = 25
const clamp = (s) => Math.max(0, Math.min(100, s))

/**
 * The stored features of one Overpass element (as served in pois.el):
 * { q: deck score 0-100 after the chain penalty, cat: categoryCode, flags }.
 */
export function poiFeatures(el) {
  const t = el.tags || {}
  const name = t.name || t['name:en']
  const lat = el.lat || el.center?.lat
  const lng = el.lon || el.center?.lon
  // as parseOverpassResponse: the first of these tags names the type
  const type = t.amenity || t.tourism || t.leisure || t.historic || t.shop || t.natural || t.man_made || t.landuse || 'place'
  const cat = categoryCode(type)
  if (!lat || !lng || !name) return { q: 0, cat, flags: SKIP }
  const boring = hasBoringName(name)
  const score = clamp(rawScore(t, type, name) + (cat ? BOOST : 0))
  const access = String(t.access || '').toLowerCase()
  // filterPlaces: minScore 25, access, blacklisted type and boring name unless rescued
  const eligible = score >= MIN_SCORE &&
    access !== 'private' && access !== 'no' &&
    (!isBlacklisted(type) || !!(t.wikipedia || t.wikidata || t.tourism === 'attraction' || t.heritage || t.designation || t.fee === 'yes')) &&
    (!boring || !!(t.wikipedia || t.heritage || t.tourism === 'attraction'))
  let flags = eligible ? ELIGIBLE : 0
  if (t.opening_hours) flags |= HAS_HOURS | openSlots(t.opening_hours)
  return { q: isChain(t, type, name) ? Math.max(0, score - CHAIN_PENALTY) : score, cat, flags }
}

// ---- The cap ----
const RINGS = [1, 2, 5, 10, 20, Infinity]
const STRATUM_MIN = 25
const FLOOR_GRID = 5 // sub-cells per side of the slack square (see step 2)
// rank points per better place in the same ~500 m zone. Kept on data: with it deleted (cap
// 3,500, 2026-09-28) every gate passed except the positional deck check at London 30 km
// food, 0.89 < 0.90 (0.92 with it), though swiped-200 improved (London 15 km 0.87 -> 0.95)
const ZONE_DEPTH_PENALTY = 3
const FILL_POWER = 0.3 // category share of the fill grows with (size)^0.3

const groupBy = (list, key) => {
  const m = new Map()
  for (const p of list) {
    const k = key(p)
    const g = m.get(k)
    if (g) g.push(p); else m.set(k, [p])
  }
  return m
}
// list sorted by keyOf descending (to 1/16 point, keys clamped to -100..150), ties in list order.
// Key and position are packed into one uint32 so the typed-array sort runs natively. Lists are < 2^20 long.
const sortDesc = (list, keyOf) => {
  const packed = new Uint32Array(list.length)
  for (let j = 0; j < list.length; j++) {
    const key = Math.max(-100, Math.min(150, keyOf(list[j])))
    packed[j] = Math.round((150 - key) * 16) * 1048576 + j
  }
  packed.sort()
  const out = new Array(list.length)
  for (let j = 0; j < list.length; j++) out[j] = list[packed[j] & 0xfffff]
  return out
}

/**
 * The <= cap rows to serve, in their original order (rows at or under cap come
 * back as the same array). `slack` (degrees): how far the phone's own position
 * may be from `center` (the server only sees the snapped bbox, shared by every
 * phone in a 0.01 degree cell), so the stratum floor holds from anywhere within
 * it. Each row needs min_lat, max_lat, min_lon, max_lon, q,
 * cat, flags; its position is the centre of its bounds (a node's own point).
 * Deterministic for a given row order: callers pass rows in (osm_type, osm_id)
 * order, as the DB serves them.
 */
export function rankCap(rows, center, cap, slack = 0) {
  if (rows.length <= cap) return rows

  const places = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.flags & SKIP) continue
    const lat = (r.min_lat + r.max_lat) / 2
    const lng = (r.min_lon + r.max_lon) / 2
    const d = haversineKm(center.lat, center.lng, lat, lng)
    places.push({
      i, lat, lng, cat: r.cat, eligible: (r.flags & ELIGIBLE) !== 0, d, score: r.q, rank: 0, key: 0, zi: 0,
      open: r.flags & HAS_HOURS ? r.flags & OPEN_MASK : -1,
      ring: RINGS.findIndex(x => d <= x),
      // the client's ~500 m zone (placeFilter getGeoZone), packed into a small int for fast Map keys
      zone: (Math.floor(lat / ZONE_DEG) & 0x7fff) * 0x8000 + (Math.floor(lng / ZONE_DEG) & 0x7fff),
    })
  }

  // deckRank without open-now and jitter: score + up to 20 for nearness
  const maxD = places.reduce((m, p) => (p.eligible && p.d > m ? p.d : m), 0)
  for (const p of places) p.rank = p.score + (maxD > 0 ? NEAREST * (1 - p.d / maxD) : 0)

  const keep = new Uint8Array(rows.length)
  let kept = 0
  const take = (p) => { if (!keep[p.i] && kept < cap) { keep[p.i] = 1; kept++ } }
  const byCategory = [...groupBy(places.filter(p => p.eligible), p => p.cat).values()]

  // 1. the farthest eligible place of each category pins the client's maxDistance
  for (const list of byCategory) take(list.reduce((a, b) => (b.d > a.d ? b : a)))

  // 2. stratum floor: min(size, 25) of each category x ring stratum, for EVERY phone position
  //    within `slack` of the centre (the phones sharing this snapped body), deck-eligible first.
  //    The square is split into FLOOR_GRID x FLOOR_GRID sub-cells, each within `delta` km of its
  //    centre g. For a phone at u near g, |d_u - d_g| <= delta (triangle inequality, the same
  //    haversine the phone uses), so per stratum:
  //      core = places whose ring holds for every such u (d_g at least delta inside the ring)
  //      wide = places whose ring holds for some such u (d_g within delta of the ring)
  //    If core has 25, its best 25 are in the phone's stratum wherever it is; if not, keeping
  //    all of wide keeps the phone's whole stratum. Either way the floor holds for every u.
  const floorRank = p => (p.eligible ? p.rank : p.rank - 130)
  const byFloor = sortDesc(places, floorRank)
  const cells = slack ? FLOOR_GRID : 1
  const step = (2 * slack) / cells
  const origins = []
  for (let a = 0; a < cells; a++) {
    for (let b = 0; b < cells; b++) origins.push({ lat: center.lat - slack + step * (a + 0.5), lng: center.lng - slack + step * (b + 0.5) })
  }
  const delta = slack
    ? Math.max(...origins.flatMap(o => [haversineKm(o.lat, o.lng, o.lat + step / 2, o.lng + step / 2), haversineKm(o.lat, o.lng, o.lat - step / 2, o.lng + step / 2)])) + 1e-6
    : 0
  const R = RINGS.length
  const buckets = (Math.max(0, ...places.map(p => p.cat)) + 1) * R
  const dist = new Float64Array(byFloor.length)
  // haversine (shared/geo.mjs, as the phone) with the per-place terms computed once; any float
  // difference from the phone's own is ~1e-12 km, inside the 1e-6 km added to delta
  const RAD = Math.PI / 180
  const latR = Float64Array.from(byFloor, p => p.lat * RAD)
  const lngR = Float64Array.from(byFloor, p => p.lng * RAD)
  const cosLat = latR.map(Math.cos)
  for (const o of origins) {
    const core = new Uint8Array(buckets)
    const oLat = o.lat * RAD
    const oLng = o.lng * RAD
    const oCos = Math.cos(oLat)
    for (let j = 0; j < byFloor.length; j++) {
      const p = byFloor[j]
      let d = p.d
      if (slack) {
        const a = Math.sin((latR[j] - oLat) / 2) ** 2 + oCos * cosLat[j] * Math.sin((lngR[j] - oLng) / 2) ** 2
        d = 2 * 6371 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      }
      dist[j] = d
      const k = RINGS.findIndex(x => d + delta <= x)
      if (k > 0 && d - delta <= RINGS[k - 1]) continue // near an edge: in the band, not the core
      const b = p.cat * R + k
      if (core[b] < STRATUM_MIN) { core[b]++; take(p) }
    }
    if (!delta) continue
    for (let j = 0; j < byFloor.length; j++) {
      const p = byFloor[j]
      const d = dist[j]
      for (let k = 0; k < R; k++) {
        const lo = k ? RINGS[k - 1] : -Infinity
        if (d + delta > lo && d - delta <= RINGS[k] && core[p.cat * R + k] < STRATUM_MIN) { take(p); break }
      }
    }
  }

  // 3. fill. The client deals each zone's leader, and open-now/jitter (unknown here, ~35 points)
  //    decide who leads, so a zone's runner-up beats a weak leader elsewhere: penalise each place
  //    by how many in its zone outrank it. Queues (category x time of day) take weighted turns.
  const queues = byCategory.flatMap(list => {
    const zoneIds = new Map()
    for (const p of list) p.zi = zoneIds.get(p.zone) ?? zoneIds.set(p.zone, zoneIds.size).get(p.zone)
    return SLOTS.map((_, k) => {
      const openKey = (p) => p.rank + (p.open < 0 ? 0 : p.open & (1 << k) ? OPEN_NOW : CLOSED_NOW)
      const depth = new Int32Array(zoneIds.size)
      for (const p of sortDesc(list, openKey)) p.key = openKey(p) - ZONE_DEPTH_PENALTY * depth[p.zi]++
      return sortDesc(list, p => p.key)
    })
  })
  const longest = Math.max(0, ...queues.map(q => q.length))
  const pos = queues.map(() => 0)
  for (let round = 1; kept < cap && round <= longest; round++) {
    queues.forEach((q, k) => {
      const upto = Math.min(q.length, Math.ceil(round * (q.length / longest) ** FILL_POWER))
      while (pos[k] < upto) take(q[pos[k]++])
    })
  }

  return rows.filter((_, i) => keep[i])
}

/**
 * OSM Tag Mapping — maps each place type to the OSM key(s) it lives
 * under. Used by apiClient.js to group types into one regex per key
 * for compact Overpass queries:
 *
 *   nw["amenity"~"^(restaurant|cafe|pub|...)$"];
 *   nw["shop"~"^(books|gift|...)$"];
 *   ...
 *
 * One Overpass clause per OSM key. Adding more types to a key just
 * extends the alternation — it doesn't add clauses, so it doesn't
 * slow the query. Adding a NEW key DOES add a clause; we keep the
 * key set small (12 keys total) for that reason.
 *
 * Every value here is canonical OSM, cross-checked against
 * taginfo.openstreetmap.org top-values for each key. Previously this
 * mapping listed many invented types (bookshop, gift_shop,
 * coffee_shop, gastropub, secret_garden, etc.) that don't exist as
 * OSM values — those entries silently produced zero matches.
 *
 * Reference: https://taginfo.openstreetmap.org/
 */

export const TYPE_TO_KEYS: Record<string, string[]> = {
  // ─── FOOD: amenity (eating out) ─────────────────────────────────
  restaurant: ['amenity'],
  cafe: ['amenity'],
  bar: ['amenity'],
  pub: ['amenity'],
  fast_food: ['amenity'],
  biergarten: ['amenity'],
  ice_cream: ['amenity', 'shop'],
  food_court: ['amenity'],

  // ─── FOOD: shop (specialty food retail) ────────────────────────
  bakery: ['shop'],
  butcher: ['shop'],
  cheese: ['shop'],
  chocolate: ['shop'],
  confectionery: ['shop'],
  deli: ['shop'],
  farm: ['shop'],
  greengrocer: ['shop'],
  pastry: ['shop'],
  seafood: ['shop'],
  tea: ['shop'],
  wine: ['shop'],
  coffee: ['shop'],
  dairy: ['shop'],
  pasta: ['shop'],
  spices: ['shop'],
  health_food: ['shop'],

  // ─── NATURE: leisure ────────────────────────────────────────────
  park: ['leisure'],
  garden: ['leisure'],
  nature_reserve: ['leisure'],
  recreation_ground: ['leisure'],
  bird_hide: ['leisure'],
  wildlife_hide: ['leisure'],
  common: ['leisure'],
  dog_park: ['leisure'],

  // ─── NATURE: tourism ───────────────────────────────────────────
  viewpoint: ['tourism'],
  picnic_site: ['tourism'],

  // ─── NATURE: natural ───────────────────────────────────────────
  beach: ['natural'],
  peak: ['natural'],
  cliff: ['natural'],
  cave_entrance: ['natural'],
  spring: ['natural'],
  hot_spring: ['natural'],
  heath: ['natural'],
  moor: ['natural'],
  volcano: ['natural'],
  geyser: ['natural'],
  bay: ['natural'],
  cape: ['natural'],
  wood: ['natural'],

  // ─── CULTURE: amenity ──────────────────────────────────────────
  theatre: ['amenity'],
  arts_centre: ['amenity'],
  library: ['amenity'],
  cinema: ['amenity'],
  community_centre: ['amenity'],
  exhibition_centre: ['amenity'],
  music_venue: ['amenity'],
  planetarium: ['amenity'],
  events_venue: ['amenity'],
  public_bookcase: ['amenity'],
  studio: ['amenity'],

  // ─── CULTURE: tourism ──────────────────────────────────────────
  museum: ['tourism'],
  gallery: ['tourism'],

  // ─── HISTORIC: historic (taginfo top-30 canonical values) ─────
  castle: ['historic'],
  manor: ['historic'],
  monument: ['historic'],
  memorial: ['historic'],
  ruins: ['historic'],
  archaeological_site: ['historic'],
  fort: ['historic'],
  citywalls: ['historic'],
  city_gate: ['historic'],
  tomb: ['historic'],
  mine: ['historic'],
  church: ['historic'],
  battlefield: ['historic'],
  heritage: ['historic'],
  wayside_shrine: ['historic'],
  wayside_cross: ['historic'],
  milestone: ['historic'],
  mine_shaft: ['historic'],
  cannon: ['historic'],
  aircraft: ['historic'],
  wreck: ['historic'],
  monastery: ['amenity'],

  // ─── ENTERTAINMENT: leisure ────────────────────────────────────
  bowling_alley: ['leisure'],
  miniature_golf: ['leisure'],
  water_park: ['leisure'],
  amusement_arcade: ['leisure'],
  escape_game: ['leisure'],
  trampoline_park: ['leisure'],
  high_ropes_course: ['leisure'],
  disc_golf_course: ['leisure'],
  ice_rink: ['leisure'],
  horse_riding: ['leisure'],
  sauna: ['leisure'],
  adult_gaming_centre: ['leisure'],
  dance: ['leisure'],

  // ─── ENTERTAINMENT: tourism ────────────────────────────────────
  zoo: ['tourism'],
  aquarium: ['tourism'],
  theme_park: ['tourism'],

  // ─── ENTERTAINMENT: amenity ────────────────────────────────────
  casino: ['amenity'],
  gambling: ['amenity'],

  // ─── ENTERTAINMENT: shop ───────────────────────────────────────
  video_games: ['shop'],

  // ─── NIGHTLIFE: amenity ────────────────────────────────────────
  nightclub: ['amenity'],

  // ─── ACTIVE: leisure ───────────────────────────────────────────
  sports_centre: ['leisure'],
  sports_hall: ['leisure'],
  swimming_pool: ['leisure'],
  swimming_area: ['leisure'],
  bathing_place: ['leisure'],
  pitch: ['leisure'],
  track: ['leisure'],
  golf_course: ['leisure'],
  fitness_centre: ['leisure'],
  fitness_station: ['leisure'],
  stadium: ['leisure'],
  marina: ['leisure'],
  slipway: ['leisure'],
  fishing: ['leisure'],
  beach_resort: ['leisure'],

  // ─── UNIQUE: tourism ───────────────────────────────────────────
  artwork: ['tourism'],
  attraction: ['tourism'],

  // ─── UNIQUE: amenity ───────────────────────────────────────────
  fountain: ['amenity'],

  // ─── UNIQUE: man_made ──────────────────────────────────────────
  lighthouse: ['man_made'],
  windmill: ['man_made'],
  water_tower: ['man_made'],
  tower: ['man_made'],
  bridge: ['man_made'],

  // ─── UNIQUE: leisure ───────────────────────────────────────────
  bandstand: ['leisure'],
  firepit: ['leisure'],

  // ─── SHOPPING: amenity ─────────────────────────────────────────
  marketplace: ['amenity'],

  // ─── SHOPPING: shop (canonical OSM values, taginfo top-50) ────
  antiques: ['shop'],
  art: ['shop'],
  bag: ['shop'],
  books: ['shop'],
  boutique: ['shop'],
  candles: ['shop'],
  charity: ['shop'],
  clothes: ['shop'],
  collector: ['shop'],
  comics: ['shop'],
  craft: ['shop'],
  fabric: ['shop'],
  florist: ['shop'],
  frame: ['shop'],
  furniture: ['shop'],
  games: ['shop'],
  gift: ['shop'],
  houseware: ['shop'],
  interior_decoration: ['shop'],
  jewelry: ['shop'],
  kitchen: ['shop'],
  leather: ['shop'],
  lighting: ['shop'],
  model: ['shop'],
  music: ['shop'],
  musical_instrument: ['shop'],
  outdoor: ['shop'],
  party: ['shop'],
  perfumery: ['shop'],
  photo: ['shop'],
  pottery: ['shop'],
  second_hand: ['shop'],
  shoes: ['shop'],
  sports: ['shop'],
  stationery: ['shop'],
  toys: ['shop'],
  watches: ['shop'],
  bicycle: ['shop'],
  camera: ['shop'],
  anime: ['shop'],
}

/**
 * Default fallback keys for unmapped types. Used when OpenTripMap or
 * another source returns a place with a type we don't recognise —
 * we still want to ATTEMPT to query Overpass for it, just in case.
 */
const DEFAULT_KEYS = ['amenity', 'tourism']

/**
 * Get OSM keys for a given type.
 */
export function getKeysForType(type: string): string[] {
  return TYPE_TO_KEYS[type] || DEFAULT_KEYS
}

/**
 * Group types by their OSM keys for efficient query building.
 *
 * Returns `Record<key, types[]>` where each type appears under every
 * key it maps to (deduplicated). The caller emits one Overpass clause
 * per key with all types as a regex alternation, so this is the step
 * that keeps query clauses small even when types are numerous.
 */
export function groupTypesByKey(types: string[]): Record<string, string[]> {
  const grouped: Record<string, Set<string>> = {}

  for (const type of types) {
    const keys = getKeysForType(type)

    for (const key of keys) {
      if (!grouped[key]) {
        grouped[key] = new Set()
      }
      grouped[key].add(type)
    }
  }

  return Object.fromEntries(
    Object.entries(grouped).map(([k, v]) => [k, [...v]]),
  )
}

/**
 * Count how many query clauses will be generated.
 * Each key generates 1 clause (nw — node+way combined).
 */
export function countQueryClauses(types: string[]): number {
  const grouped = groupTypesByKey(types)
  return Object.keys(grouped).length
}

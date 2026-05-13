/**
 * OSM Tag Mapping - Maps place types to their canonical OSM keys
 *
 * This dramatically reduces Overpass query size by only querying
 * the OSM keys that actually contain each type.
 *
 * Reference: https://wiki.openstreetmap.org/wiki/Key:amenity
 */

/**
 * Canonical mapping of place types to OSM keys.
 * Most types map to a single key; some may appear under multiple keys.
 */
export const TYPE_TO_KEYS: Record<string, string[]> = {
  // FOOD & DRINK
  restaurant: ['amenity'],
  cafe: ['amenity'],
  bar: ['amenity'],
  pub: ['amenity'],
  bakery: ['shop', 'amenity'],
  ice_cream: ['amenity', 'shop'],
  food_court: ['amenity'],
  fast_food: ['amenity'],
  biergarten: ['amenity'],
  wine_bar: ['amenity'],
  cocktail_bar: ['amenity'],
  coffee_shop: ['amenity', 'shop'],
  tea_house: ['amenity', 'shop'],
  deli: ['shop'],
  bistro: ['amenity'],
  brasserie: ['amenity'],
  fish_and_chips: ['amenity', 'shop'],
  tearoom: ['amenity'],
  farm_shop: ['shop'],
  gastropub: ['amenity'],

  // NATURE & OUTDOORS
  park: ['leisure'],
  garden: ['leisure'],
  nature_reserve: ['leisure'],
  viewpoint: ['tourism'],
  beach: ['natural'],
  forest: ['natural', 'landuse'],
  national_park: ['leisure', 'boundary'],
  botanical_garden: ['leisure'],
  wildlife_reserve: ['leisure'],
  lake: ['natural'],
  waterfall: ['natural'],
  hill: ['natural'],
  peak: ['natural'],
  cliff: ['natural'],
  cave: ['natural'],
  common: ['leisure', 'landuse'],
  country_park: ['leisure'],
  wood: ['natural', 'landuse'],
  heath: ['natural'],
  moor: ['natural'],
  green: ['leisure', 'landuse'],
  recreation_ground: ['leisure'],
  bird_hide: ['leisure'],
  picnic_site: ['tourism'],
  meadow: ['landuse'],

  // ARTS & CULTURE
  museum: ['tourism'],
  gallery: ['tourism', 'amenity'],
  theatre: ['amenity'],
  arts_centre: ['amenity'],
  library: ['amenity'],
  cultural_centre: ['amenity'],
  exhibition: ['tourism'],
  concert_hall: ['amenity'],
  opera_house: ['amenity'],
  community_centre: ['amenity'],
  cinema: ['amenity'],
  art_gallery: ['tourism', 'amenity'],
  heritage_centre: ['tourism'],
  visitor_centre: ['tourism'],
  information: ['tourism'],

  // HISTORY & HERITAGE
  castle: ['historic'],
  monument: ['historic'],
  memorial: ['historic'],
  archaeological_site: ['historic'],
  ruins: ['historic'],
  heritage: ['historic'],
  historic: ['historic'],
  manor: ['historic'],
  palace: ['historic'],
  abbey: ['historic', 'amenity'],
  cathedral: ['amenity', 'building'],
  church: ['amenity', 'building'],
  chapel: ['amenity', 'building'],
  tower: ['man_made', 'historic'],
  fort: ['historic'],
  battlefield: ['historic'],
  stately_home: ['historic', 'tourism'],
  folly: ['historic'],
  priory: ['historic'],
  standing_stone: ['historic'],
  barrow: ['historic'],
  hill_fort: ['historic'],
  roman: ['historic'],
  saxon: ['historic'],
  medieval: ['historic'],
  tudor: ['historic'],
  victorian: ['historic'],
  listed_building: ['historic'],
  war_memorial: ['historic'],
  milestone: ['historic'],
  canal_lock: ['historic', 'waterway'],

  // ENTERTAINMENT
  bowling_alley: ['leisure'],
  arcade: ['leisure', 'amenity'],
  escape_game: ['leisure'],
  zoo: ['tourism'],
  aquarium: ['tourism'],
  theme_park: ['tourism'],
  amusement_park: ['tourism', 'leisure'],
  miniature_golf: ['leisure'],
  laser_tag: ['leisure'],
  trampoline_park: ['leisure'],
  go_kart: ['leisure'],
  casino: ['amenity'],
  soft_play: ['leisure'],
  crazy_golf: ['leisure'],
  adventure_playground: ['leisure'],
  petting_zoo: ['tourism'],
  farm_park: ['tourism', 'leisure'],
  model_railway: ['tourism'],
  bingo: ['amenity'],

  // NIGHTLIFE
  nightclub: ['amenity'],
  club: ['amenity', 'leisure'],
  beer_garden: ['amenity', 'leisure'],
  jazz_club: ['amenity'],
  comedy_club: ['amenity'],
  karaoke: ['amenity'],
  lounge: ['amenity'],
  speakeasy: ['amenity'],
  music_venue: ['amenity'],
  live_music: ['amenity'],
  social_club: ['amenity'],

  // ACTIVE & SPORTS
  sports_centre: ['leisure'],
  swimming_pool: ['leisure', 'amenity'],
  gym: ['leisure', 'amenity'],
  climbing: ['leisure', 'sport'],
  golf_course: ['leisure'],
  tennis: ['leisure', 'sport'],
  basketball: ['leisure', 'sport'],
  skate_park: ['leisure'],
  ice_rink: ['leisure'],
  bowling: ['leisure'],
  yoga: ['leisure', 'amenity'],
  dance: ['leisure', 'amenity'],
  martial_arts: ['leisure', 'amenity'],
  horse_riding: ['leisure'],
  cricket: ['leisure', 'sport'],
  football: ['leisure', 'sport'],
  rugby: ['leisure', 'sport'],
  pitch: ['leisure'],
  athletics: ['leisure', 'sport'],
  walking_route: ['leisure'],
  cycle_path: ['leisure'],
  disc_golf: ['leisure'],
  water_sports: ['leisure', 'sport'],
  sailing: ['leisure', 'sport'],
  kayak: ['leisure', 'sport'],
  lido: ['leisure', 'amenity'],
  paddling_pool: ['leisure'],

  // HIDDEN GEMS & UNIQUE
  artwork: ['tourism'],
  fountain: ['amenity'],
  observation: ['tourism', 'man_made'],
  lighthouse: ['man_made'],
  windmill: ['man_made'],
  street_art: ['tourism'],
  mural: ['tourism'],
  sculpture: ['tourism'],
  rooftop: ['tourism', 'amenity'],
  secret_garden: ['leisure'],
  curiosity: ['tourism'],
  unusual: ['tourism'],
  bandstand: ['amenity', 'leisure'],
  clock_tower: ['man_made', 'amenity'],
  dovecote: ['historic', 'man_made'],
  ice_house: ['historic'],
  oast_house: ['historic', 'man_made'],
  toll_house: ['historic'],
  water_tower: ['man_made'],
  walled_garden: ['leisure'],
  maze: ['tourism', 'leisure'],
  grotto: ['tourism', 'natural'],

  // MARKETS & SHOPS
  marketplace: ['amenity'],
  market: ['shop', 'amenity'],
  flea_market: ['amenity', 'shop'],
  farmers_market: ['amenity'],
  antique: ['shop'],
  vintage: ['shop'],
  bookshop: ['shop'],
  record_shop: ['shop'],
  craft_shop: ['shop'],
  gift_shop: ['shop'],
  boutique: ['shop'],
  charity_shop: ['shop'],
  car_boot_sale: ['amenity'],
  indoor_market: ['amenity', 'shop'],
  arcade_shops: ['shop'],
  covered_market: ['amenity'],
  high_street: ['shop'],

  // TOURISM BASICS
  attraction: ['tourism'],
}

/**
 * Default fallback keys for unmapped types
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
 * key it maps to (deduplicated).
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

  // Convert Sets to Arrays for easier consumption
  return Object.fromEntries(
    Object.entries(grouped).map(([k, v]) => [k, [...v]]),
  )
}

/**
 * Count how many query clauses will be generated.
 * Each key generates 2 clauses (node + way).
 */
export function countQueryClauses(types: string[]): number {
  const grouped = groupTypesByKey(types)
  return Object.keys(grouped).length * 2
}

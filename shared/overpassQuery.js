export const GOOD_CATEGORY_TYPES = {
  food: [
    'restaurant', 'cafe', 'pub', 'bar', 'fast_food', 'biergarten',
    'ice_cream', 'food_court',
    'bakery', 'butcher', 'cheese', 'chocolate', 'confectionery',
    'deli', 'farm', 'greengrocer', 'pastry', 'seafood', 'tea',
    'wine', 'coffee', 'dairy', 'pasta', 'spices', 'health_food',
  ],
  nature: [
    'park', 'garden', 'nature_reserve', 'recreation_ground',
    'bird_hide', 'wildlife_hide', 'common', 'dog_park',
    'viewpoint', 'picnic_site',
    'beach', 'peak', 'cliff', 'cave_entrance', 'spring', 'hot_spring',
    'heath', 'moor', 'volcano', 'geyser', 'bay', 'cape', 'wood',
    'waterfall', 'forest',
  ],
  culture: [
    'theatre', 'arts_centre', 'library', 'cinema', 'community_centre',
    'exhibition_centre', 'music_venue', 'planetarium', 'events_venue',
    'public_bookcase', 'studio',
    'museum', 'gallery',
  ],
  historic: [
    'castle', 'manor', 'monument', 'memorial', 'ruins',
    'archaeological_site', 'fort', 'citywalls', 'city_gate',
    'tomb', 'mine', 'church', 'battlefield', 'heritage',
    'wayside_shrine', 'wayside_cross', 'milestone', 'mine_shaft',
    'cannon', 'aircraft', 'wreck', 'temple',
    'monastery', 'grave_yard',
    'palace', 'bath',
  ],
  entertainment: [
    'bowling_alley', 'miniature_golf', 'water_park',
    'amusement_arcade', 'escape_game', 'trampoline_park',
    'high_ropes_course', 'disc_golf_course', 'ice_rink',
    'horse_riding', 'sauna', 'adult_gaming_centre', 'dance',
    'resort',
    'zoo', 'aquarium', 'theme_park',
    'casino', 'gambling',
    'video_games',
  ],
  nightlife: [
    'nightclub',
  ],
  active: [
    'sports_centre', 'sports_hall', 'swimming_pool', 'swimming_area',
    'bathing_place', 'pitch', 'track', 'golf_course', 'fitness_centre',
    'fitness_station', 'stadium', 'marina', 'slipway', 'fishing',
    'beach_resort',
  ],
  unique: [
    'artwork', 'attraction',
    'fountain',
    'lighthouse', 'windmill', 'water_tower', 'tower', 'bridge',
    'bandstand', 'firepit',
    'pier',
  ],
  shopping: [
    'marketplace',
    'mall', 'antiques', 'art', 'bag', 'books', 'boutique', 'candles',
    'charity', 'clothes', 'collector', 'comics', 'craft', 'fabric',
    'florist', 'frame', 'furniture', 'games', 'gift', 'houseware',
    'interior_decoration', 'jewelry', 'kitchen', 'leather', 'lighting',
    'model', 'music', 'musical_instrument', 'outdoor', 'party',
    'perfumery', 'photo', 'pottery', 'second_hand', 'shoes', 'sports',
    'stationery', 'toys', 'watches', 'bicycle', 'camera', 'anime',
  ],
}

export const TYPE_TO_KEYS = {
  restaurant: ['amenity'],
  cafe: ['amenity'],
  bar: ['amenity'],
  pub: ['amenity'],
  fast_food: ['amenity'],
  biergarten: ['amenity'],
  ice_cream: ['amenity', 'shop'],
  food_court: ['amenity'],
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
  park: ['leisure'],
  garden: ['leisure'],
  nature_reserve: ['leisure'],
  recreation_ground: ['leisure'],
  bird_hide: ['leisure'],
  wildlife_hide: ['leisure'],
  common: ['leisure'],
  dog_park: ['leisure'],
  viewpoint: ['tourism'],
  picnic_site: ['tourism'],
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
  waterfall: ['natural'],
  forest: ['natural'],
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
  museum: ['tourism'],
  gallery: ['tourism'],
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
  temple: ['historic'],
  monastery: ['amenity'],
  grave_yard: ['amenity'],
  palace: ['historic'],
  bath: ['historic'],
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
  resort: ['leisure'],
  zoo: ['tourism'],
  aquarium: ['tourism'],
  theme_park: ['tourism'],
  casino: ['amenity'],
  gambling: ['amenity'],
  video_games: ['shop'],
  nightclub: ['amenity'],
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
  artwork: ['tourism'],
  attraction: ['tourism'],
  fountain: ['amenity'],
  lighthouse: ['man_made'],
  windmill: ['man_made'],
  water_tower: ['man_made'],
  tower: ['man_made'],
  bridge: ['man_made'],
  pier: ['man_made'],
  bandstand: ['leisure'],
  firepit: ['leisure'],
  marketplace: ['amenity'],
  mall: ['shop'],
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

const DEFAULT_KEYS = ['amenity', 'tourism']

// The type caps below keep only the first N types, so this order decides what the
// default (all-categories) deck can contain. The first 20 are the large-radius set;
// the next 15 fill the 35 kept for local decks. Without it the cap kept GOOD_CATEGORY_TYPES'
// food-first order, and the default deck had no museums, sights or libraries at all.
const PRIORITY_TYPES = [
  'attraction', 'museum', 'gallery', 'castle', 'ruins', 'viewpoint', 'park', 'nature_reserve',
  'library', 'theatre', 'zoo', 'aquarium', 'restaurant', 'pub', 'cafe', 'beach', 'monument',
  'garden', 'cinema', 'waterfall',
  'bar', 'arts_centre', 'theme_park', 'manor', 'palace', 'archaeological_site', 'ice_cream',
  'bakery', 'biergarten', 'planetarium', 'music_venue', 'bowling_alley', 'picnic_site',
  // dog mode (applyFilters dogCheck) passes these without a dog tag, so the default deck must fetch them
  'dog_park', 'recreation_ground',
  // memorial and artwork stay out of the default deck: York alone has 100+ (plaques, war
  // memorials). They're still in the historic and unique category decks.
]
const priorityRank = type => {
  const i = PRIORITY_TYPES.indexOf(type)
  return i === -1 ? PRIORITY_TYPES.length : i
}

export function getTypesForCategory(categoryKey) {
  return GOOD_CATEGORY_TYPES[categoryKey] || []
}

export function getAllGoodTypes() {
  return Object.values(GOOD_CATEGORY_TYPES).flat()
}

export function getKeysForType(type) {
  return TYPE_TO_KEYS[type] || DEFAULT_KEYS
}

export function groupTypesByKey(types) {
  const grouped = {}

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
    Object.entries(grouped).map(([key, values]) => [key, [...values]]),
  )
}

export function countQueryClauses(types) {
  return Object.keys(groupTypesByKey(types)).length
}

export function radiusToBbox(lat, lng, radius) {
  const latDelta = radius / 111320
  const lngDelta = radius / (111320 * Math.cos(lat * Math.PI / 180))

  return {
    south: lat - latDelta,
    north: lat + latDelta,
    west: lng - lngDelta,
    east: lng + lngDelta,
  }
}

function escapeOverpassRegex(value) {
  return value.replace(/[\\.^$|?*+()[\]{}]/g, '\\$&')
}

export function selectOverpassTypesForRadius(types, radius) {
  const isLargeRadius = radius > 15000
  const maxTypes = isLargeRadius ? 20 : 35

  // Stable sort: priority types first in PRIORITY_TYPES order, the rest keep their category order
  return [...types].sort((a, b) => priorityRank(a) - priorityRank(b)).slice(0, maxTypes)
}

export function buildOverpassQuery(lat, lng, radius, types) {
  const timeout = 20
  const isVeryLargeRadius = radius > 50000
  const nameFilter = isVeryLargeRadius ? '["name"]' : ''

  const uniqueTypes = Array.from(new Set(types)).filter(Boolean)
  if (uniqueTypes.length === 0) {
    return {
      query: `[out:json][timeout:${timeout}];();out center;`,
      clauseCount: 0,
      querySize: 0,
    }
  }

  const bbox = radiusToBbox(lat, lng, radius)
  const grouped = groupTypesByKey(uniqueTypes)
  // ponytail: a box around Great Britain (it also takes in Ireland), not the build's own outline
  const inGB = lat >= 49.8 && lat <= 60.9 && lng >= -8.7 && lng <= 1.8

  const typeFilters = Object.entries(grouped)
    .map(([key, keyTypes]) => {
      const regex = keyTypes.map(escapeOverpassRegex).join('|')
      // nwr: big landmarks are often relations (multipolygons: the British Museum is r177044);
      // with nw they never reached Discover or the app's town pages. Only in GB, where our
      // POI DB answers: on public Overpass relations made Paris decks 2-3x slower (7 Oct)
      return `${inGB ? 'nwr' : 'nw'}["${key}"~"^(${regex})$"]${nameFilter};`
    })
    .join('\n      ')

  const query = `[out:json][timeout:${timeout}][bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];
(
${typeFilters}
);
out tags center;`

  return {
    query,
    clauseCount: countQueryClauses(uniqueTypes),
    querySize: query.length,
  }
}

export function buildDiscoverOverpassQuery(lat, lng, radius, category = null) {
  const types = category ? getTypesForCategory(category) : getAllGoodTypes()
  const limitedTypes = selectOverpassTypesForRadius(types, radius)
  return buildOverpassQuery(lat, lng, radius, limitedTypes)
}

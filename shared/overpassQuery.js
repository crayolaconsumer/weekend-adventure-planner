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

const LARGE_RADIUS_PRIORITY_TYPES = [
  'attraction', 'museum', 'castle', 'ruins', 'monument', 'viewpoint', 'park', 'nature_reserve',
  'restaurant', 'pub', 'cafe', 'cinema', 'theatre', 'artwork', 'memorial', 'beach', 'waterfall',
]

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

  if (!isLargeRadius) {
    return types.slice(0, maxTypes)
  }

  const priority = types.filter(type => LARGE_RADIUS_PRIORITY_TYPES.includes(type))
  const others = types.filter(type => !LARGE_RADIUS_PRIORITY_TYPES.includes(type))
  return [...priority, ...others].slice(0, maxTypes)
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

  const typeFilters = Object.entries(grouped)
    .map(([key, keyTypes]) => {
      const regex = keyTypes.map(escapeOverpassRegex).join('|')
      return `nw["${key}"~"^(${regex})$"]${nameFilter};`
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

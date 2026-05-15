/**
 * ROAM Place Categories
 * Curated categories for adventure-worthy places
 */

export interface Category {
  label: string
  icon: string
  color: string
  types: string[]
}

export type CategoryKey =
  | 'food' | 'nature' | 'culture' | 'historic' | 'entertainment'
  | 'nightlife' | 'active' | 'unique' | 'shopping'

export interface CategoryWithKey extends Category {
  key: CategoryKey
}

// What we WANT - adventure-worthy places.
//
// Every value below is a CANONICAL OSM tag value verified against
// taginfo.openstreetmap.org. Previously this list contained many
// invented values like `bookshop`, `record_shop`, `gift_shop`,
// `gastropub`, `secret_garden`, `flea_market`, `high_street` etc.
// that don't exist in OSM — Overpass queries built from them
// returned zero matches, which is why entire categories like Markets
// & Shops felt broken in towns full of real shops.
//
// Performance note: expanding the regex per OSM key here doesn't add
// query clauses (we still issue one nw[key~"regex"] per distinct OSM
// key, the regex just has more alternations). Overpass handles long
// regexes efficiently; the bottleneck is clause count, not regex
// length. Total clauses unchanged from before this rewrite.
export const GOOD_CATEGORIES: Record<CategoryKey, Category> = {
  food: {
    label: 'Food & Drink',
    icon: '🍽️',
    color: '#c45c3e',
    types: [
      // amenity=*  (eating out)
      'restaurant', 'cafe', 'pub', 'bar', 'fast_food', 'biergarten',
      'ice_cream', 'food_court',
      // shop=*  (food retail — specialty + interesting)
      'bakery', 'butcher', 'cheese', 'chocolate', 'confectionery',
      'deli', 'farm', 'greengrocer', 'pastry', 'seafood', 'tea',
      'wine', 'coffee', 'dairy', 'pasta', 'spices', 'health_food',
    ],
  },
  nature: {
    label: 'Nature & Outdoors',
    icon: '🌿',
    color: '#87a28e',
    types: [
      // leisure=*
      'park', 'garden', 'nature_reserve', 'recreation_ground',
      'bird_hide', 'wildlife_hide', 'common', 'dog_park',
      // tourism=*
      'viewpoint', 'picnic_site',
      // natural=*  (discrete destinations — not every patch of grass)
      'beach', 'peak', 'cliff', 'cave_entrance', 'spring', 'hot_spring',
      'heath', 'moor', 'volcano', 'geyser', 'bay', 'cape', 'wood',
    ],
  },
  culture: {
    label: 'Arts & Culture',
    icon: '🎭',
    color: '#6b5b95',
    types: [
      // amenity=*
      'theatre', 'arts_centre', 'library', 'cinema', 'community_centre',
      'exhibition_centre', 'music_venue', 'planetarium', 'events_venue',
      'public_bookcase', 'studio',
      // tourism=*
      'museum', 'gallery',
    ],
  },
  historic: {
    label: 'History & Heritage',
    icon: '🏛️',
    color: '#8b7355',
    types: [
      // historic=*  (canonical values from taginfo top-30)
      'castle', 'manor', 'monument', 'memorial', 'ruins',
      'archaeological_site', 'fort', 'citywalls', 'city_gate',
      'tomb', 'mine', 'church', 'battlefield', 'heritage',
      'wayside_shrine', 'wayside_cross', 'milestone', 'mine_shaft',
      'cannon', 'aircraft', 'wreck',
      // amenity=*  (historic religious sites the OSM community puts here)
      'monastery',
    ],
  },
  entertainment: {
    label: 'Entertainment',
    icon: '🎪',
    color: '#e07a5f',
    types: [
      // leisure=*
      'bowling_alley', 'miniature_golf', 'water_park',
      'amusement_arcade', 'escape_game', 'trampoline_park',
      'high_ropes_course', 'disc_golf_course', 'ice_rink',
      'horse_riding', 'sauna', 'adult_gaming_centre', 'dance',
      // tourism=*
      'zoo', 'aquarium', 'theme_park',
      // amenity=*
      'casino', 'gambling',
      // shop=*  (video games is a destination shopping experience)
      'video_games',
    ],
  },
  nightlife: {
    label: 'Nightlife',
    icon: '🌙',
    color: '#4a4a8a',
    types: [
      // amenity=*  — canonical late-night venues
      'nightclub',
    ],
  },
  active: {
    label: 'Active & Sports',
    icon: '⚡',
    color: '#2d9cdb',
    types: [
      // leisure=*
      'sports_centre', 'sports_hall', 'swimming_pool', 'swimming_area',
      'bathing_place', 'pitch', 'track', 'golf_course', 'fitness_centre',
      'fitness_station', 'stadium', 'marina', 'slipway', 'fishing',
      'beach_resort',
    ],
  },
  unique: {
    label: 'Hidden Gems',
    icon: '💎',
    color: '#d4a855',
    types: [
      // tourism=*
      'artwork', 'attraction',
      // amenity=*
      'fountain',
      // man_made=*  (iconic landmarks)
      'lighthouse', 'windmill', 'water_tower', 'tower', 'bridge',
      // leisure=*
      'bandstand', 'firepit',
    ],
  },
  shopping: {
    label: 'Markets & Shops',
    icon: '🛍️',
    color: '#9b59b6',
    types: [
      // amenity=*  (the ONLY canonical market tag in OSM —
      // "market", "flea_market", "farmers_market", "indoor_market",
      // "covered_market", "car_boot_sale" don't exist as values)
      'marketplace',
      // shop=*  (canonical OSM values; rebuilt against taginfo top-50)
      'antiques', 'art', 'bag', 'books', 'boutique', 'candles',
      'charity', 'clothes', 'collector', 'comics', 'craft', 'fabric',
      'florist', 'frame', 'furniture', 'games', 'gift', 'houseware',
      'interior_decoration', 'jewelry', 'kitchen', 'leather', 'lighting',
      'model', 'music', 'musical_instrument', 'outdoor', 'party',
      'perfumery', 'photo', 'pottery', 'second_hand', 'shoes', 'sports',
      'stationery', 'toys', 'watches', 'bicycle', 'camera', 'anime',
    ],
  },
}

// What we EXCLUDE - boring/irrelevant places. Substring matched against
// the place's OSM type, so 'computer' catches shop=computer,
// shop=computer_repair, etc.
//
// NOTE: 'monastery' was removed from this list — it's now a positive
// match under historic/religious heritage, since OSM tags real
// historic monasteries (Buckfast Abbey, Worth Abbey, etc.) with
// amenity=monastery + tourism=attraction.
export const BLACKLIST: string[] = [
  // Healthcare (always boring as a "weekend out" destination)
  'health', 'clinic', 'hospital', 'pharmacy', 'dentist', 'doctor', 'optician',
  'veterinary', 'medical', 'nursing_home', 'hospice', 'chemist',
  // Finance / civic
  'bank', 'atm', 'post_office', 'money_transfer', 'bureau_de_change',
  'pawnbroker', 'money_lender', 'bookmaker', 'lottery',
  'police', 'fire_station', 'courthouse', 'government', 'townhall',
  'embassy', 'consulate', 'prison', 'military',
  // Education
  'school', 'college', 'kindergarten', 'university', 'driving_school',
  'childcare',
  // Cars / transit
  'fuel', 'car_wash', 'car_repair', 'car_parts', 'parking', 'garage',
  'car_rental', 'bus_station', 'taxi', 'car_sharing', 'charging_station',
  'motorcycle_parking', 'bicycle_parking', 'bicycle_rental',
  'parcel_locker', 'ferry_terminal', 'tyres', 'car', 'motorcycle',
  'caravan', 'trailer', 'truck', 'scooter',
  // Public infrastructure (not destinations)
  'toilet', 'waste_basket', 'recycling', 'waste_disposal', 'manhole',
  'telephone', 'post_box', 'bench', 'shelter', 'parking_space',
  'parking_entrance', 'vending_machine', 'street_cabinet', 'utility_pole',
  // Religious / political clubs (often closed to public weekend visitors)
  'political', 'place_of_worship', 'convent', 'grave_yard',
  // Industrial / commercial back-end
  'industrial', 'warehouse', 'storage', 'storage_rental', 'factory',
  'office', 'works', 'silo', 'pier',
  // Boring retail (chains + utilities)
  'supermarket', 'convenience', 'department_store', 'mall', 'wholesale',
  'hardware', 'electronics', 'mobile_phone', 'computer', 'kiosk',
  'variety_store', 'vacant', 'outpost',
  'doityourself', 'appliance', 'electrical', 'paint', 'tiles', 'flooring',
  'bathroom_furnishing', 'glaziery', 'trade', 'agrarian',
  // Personal services (not browseable destinations)
  'hairdresser', 'beauty', 'cosmetics', 'tobacco', 'massage',
  'laundry', 'dry_cleaning', 'tailor', 'shoe_repair',
  'locksmith', 'copyshop', 'estate_agent', 'insurance', 'lawyer',
  'travel_agency', 'funeral_directors', 'pet',
  // Private members' clubs (we expose social_centre/etc. via culture
  // but the bare ones below are typically not weekend destinations)
  'community_hall', 'conservative_club', 'working_mens_club',
  'youth_club',
]

// Words that make place names boring
export const BORING_NAME_PATTERNS: RegExp[] = [
  /health\s*cent(er|re)/i, /medical/i, /surgery/i, /dental/i, /pharmacy/i,
  /car\s*park/i, /parking/i, /petrol/i, /garage/i, /toilet/i, /wc\b/i,
  /post\s*office/i, /bank\b/i, /atm\b/i, /school/i, /college\b/i,
  /council/i, /office/i, /industrial/i, /warehouse/i, /depot/i,
  /conservative\s*club/i, /working\s*men/i, /social\s*club/i,
  /community\s*cent(er|re)/i, /sports\s*direct/i, /tesco/i, /sainsbury/i,
  /asda/i, /lidl/i, /aldi/i, /morrisons/i, /co-?op\b/i, /iceland\b/i,
  /argos/i, /halfords/i, /currys/i,
]

/** Get category for a place type */
export function getCategoryForType(type: string | null | undefined): CategoryWithKey | null {
  if (!type) return null
  for (const [categoryKey, category] of Object.entries(GOOD_CATEGORIES) as Array<[CategoryKey, Category]>) {
    if (category.types.includes(type)) {
      return { key: categoryKey, ...category }
    }
  }
  return null
}

/** Check if a type is blacklisted (substring match) */
export function isBlacklisted(type: string | null | undefined): boolean {
  if (!type) return false
  return BLACKLIST.some(blacklisted =>
    type.toLowerCase().includes(blacklisted.toLowerCase()),
  )
}

/** Check if a name matches a boring pattern */
export function hasBoringName(name: string | null | undefined): boolean {
  if (!name) return false
  return BORING_NAME_PATTERNS.some(pattern => pattern.test(name))
}

/** Get all types for a category */
export function getTypesForCategory(categoryKey: string): string[] {
  return GOOD_CATEGORIES[categoryKey as CategoryKey]?.types || []
}

/** Get all good types across all categories */
export function getAllGoodTypes(): string[] {
  return Object.values(GOOD_CATEGORIES).flatMap(cat => cat.types)
}

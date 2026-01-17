/**
 * ROAM Place Categories
 * Curated categories for adventure-worthy places
 */

// What we WANT - adventure-worthy places (with UK-specific additions)
export const GOOD_CATEGORIES = {
  food: {
    label: 'Food & Drink',
    icon: '🍽️',
    color: '#c45c3e',
    types: [
      'restaurant', 'cafe', 'bar', 'pub', 'bakery', 'ice_cream',
      'food_court', 'fast_food', 'biergarten', 'wine_bar', 'cocktail_bar',
      'coffee_shop', 'tea_house', 'deli', 'bistro', 'brasserie',
      // UK-specific
      'fish_and_chips', 'tearoom', 'farm_shop', 'gastropub'
    ]
  },
  nature: {
    label: 'Nature & Outdoors',
    icon: '🌿',
    color: '#87a28e',
    types: [
      'park', 'garden', 'nature_reserve', 'viewpoint', 'beach', 'forest',
      'national_park', 'botanical_garden', 'wildlife_reserve', 'lake',
      'waterfall', 'hill', 'peak', 'cliff', 'cave',
      // UK-specific
      'common', 'country_park', 'wood', 'heath', 'moor', 'green',
      'recreation_ground', 'bird_hide', 'picnic_site', 'meadow'
    ]
  },
  culture: {
    label: 'Arts & Culture',
    icon: '🎭',
    color: '#6b5b95',
    types: [
      'museum', 'gallery', 'theatre', 'arts_centre', 'library',
      'cultural_centre', 'exhibition', 'concert_hall', 'opera_house',
      'community_centre', 'cinema', 'art_gallery',
      // UK-specific
      'heritage_centre', 'visitor_centre', 'information'
    ]
  },
  historic: {
    label: 'History & Heritage',
    icon: '🏛️',
    color: '#8b7355',
    types: [
      'castle', 'monument', 'memorial', 'archaeological_site', 'ruins',
      'heritage', 'historic', 'manor', 'palace', 'abbey', 'cathedral',
      'church', 'chapel', 'tower', 'fort', 'battlefield',
      // UK-specific
      'stately_home', 'folly', 'priory', 'standing_stone', 'barrow',
      'hill_fort', 'roman', 'saxon', 'medieval', 'tudor', 'victorian',
      'listed_building', 'war_memorial', 'milestone', 'canal_lock'
    ]
  },
  entertainment: {
    label: 'Entertainment',
    icon: '🎪',
    color: '#e07a5f',
    types: [
      'cinema', 'bowling_alley', 'arcade', 'escape_game', 'zoo',
      'aquarium', 'theme_park', 'amusement_park', 'miniature_golf',
      'laser_tag', 'trampoline_park', 'go_kart', 'casino',
      // UK-specific
      'soft_play', 'crazy_golf', 'adventure_playground', 'petting_zoo',
      'farm_park', 'model_railway', 'bingo'
    ]
  },
  nightlife: {
    label: 'Nightlife',
    icon: '🌙',
    color: '#4a4a8a',
    types: [
      'nightclub', 'club', 'cocktail_bar', 'beer_garden', 'wine_bar',
      'jazz_club', 'comedy_club', 'karaoke', 'lounge', 'speakeasy',
      // UK-specific
      'music_venue', 'live_music', 'social_club'
    ]
  },
  active: {
    label: 'Active & Sports',
    icon: '⚡',
    color: '#2d9cdb',
    types: [
      'sports_centre', 'swimming_pool', 'gym', 'climbing', 'golf_course',
      'tennis', 'basketball', 'skate_park', 'ice_rink', 'bowling',
      'yoga', 'dance', 'martial_arts', 'horse_riding',
      // UK-specific
      'cricket', 'football', 'rugby', 'pitch', 'athletics',
      'walking_route', 'cycle_path', 'disc_golf', 'water_sports',
      'sailing', 'kayak', 'lido', 'paddling_pool'
    ]
  },
  unique: {
    label: 'Hidden Gems',
    icon: '💎',
    color: '#d4a855',
    types: [
      'artwork', 'fountain', 'observation', 'lighthouse', 'windmill',
      'street_art', 'mural', 'sculpture', 'viewpoint', 'rooftop',
      'secret_garden', 'curiosity', 'unusual',
      // UK-specific
      'bandstand', 'clock_tower', 'dovecote', 'ice_house', 'oast_house',
      'toll_house', 'water_tower', 'walled_garden', 'maze', 'grotto'
    ]
  },
  shopping: {
    label: 'Markets & Shops',
    icon: '🛍️',
    color: '#9b59b6',
    types: [
      'marketplace', 'market', 'flea_market', 'farmers_market',
      'antique', 'vintage', 'bookshop', 'record_shop', 'craft_shop',
      'gift_shop', 'boutique',
      // UK-specific
      'charity_shop', 'car_boot_sale', 'indoor_market', 'arcade_shops',
      'covered_market', 'high_street'
    ]
  }
}

// What we EXCLUDE - boring/irrelevant places
export const BLACKLIST = [
  // Healthcare
  'health', 'clinic', 'hospital', 'pharmacy', 'dentist', 'doctor', 'optician',
  'veterinary', 'medical', 'nursing_home', 'hospice',

  // Financial
  'bank', 'atm', 'post_office', 'money_transfer', 'bureau_de_change',

  // Government & Emergency
  'police', 'fire_station', 'courthouse', 'government', 'townhall',
  'embassy', 'consulate', 'prison', 'military',

  // Education (unless notable)
  'school', 'college', 'kindergarten', 'university', 'driving_school',

  // Transport & Automotive
  'fuel', 'car_wash', 'car_repair', 'parking', 'garage', 'car_rental',
  'bus_station', 'taxi', 'car_sharing', 'charging_station',

  // Utilities & Infrastructure
  'toilet', 'waste_basket', 'recycling', 'waste_disposal',
  'telephone', 'post_box', 'bench', 'shelter',

  // Political & Religious (unless historic)
  'political', 'place_of_worship', 'monastery', 'convent',

  // Industrial & Commercial
  'industrial', 'warehouse', 'storage', 'factory', 'office',

  // Generic retail
  'supermarket', 'convenience', 'department_store', 'mall',
  'hardware', 'electronics', 'mobile_phone', 'computer',

  // Services
  'hairdresser', 'beauty', 'laundry', 'dry_cleaning', 'tailor',
  'locksmith', 'copyshop', 'estate_agent', 'insurance', 'lawyer',

  // Boring names
  'community_hall', 'social_club', 'conservative_club', 'working_mens_club',
  'social_centre', 'youth_club'
]

// Words that make place names boring
export const BORING_NAME_PATTERNS = [
  /health\s*cent(er|re)/i,
  /medical/i,
  /surgery/i,
  /dental/i,
  /pharmacy/i,
  /car\s*park/i,
  /parking/i,
  /petrol/i,
  /garage/i,
  /toilet/i,
  /wc\b/i,
  /post\s*office/i,
  /bank\b/i,
  /atm\b/i,
  /school/i,
  /college\b/i,
  /council/i,
  /office/i,
  /industrial/i,
  /warehouse/i,
  /depot/i,
  /conservative\s*club/i,
  /working\s*men/i,
  /social\s*club/i,
  /community\s*cent(er|re)/i,
  /sports\s*direct/i,
  /tesco/i,
  /sainsbury/i,
  /asda/i,
  /lidl/i,
  /aldi/i,
  /morrisons/i,
  /co-?op\b/i,
  /iceland\b/i,
  /argos/i,
  /halfords/i,
  /currys/i
]

// Get category for a place type
export function getCategoryForType(type) {
  for (const [categoryKey, category] of Object.entries(GOOD_CATEGORIES)) {
    if (category.types.includes(type)) {
      return { key: categoryKey, ...category }
    }
  }
  return null
}

// Check if a type is blacklisted
export function isBlacklisted(type) {
  return BLACKLIST.some(blacklisted =>
    type.toLowerCase().includes(blacklisted.toLowerCase())
  )
}

// Check if a name is boring
export function hasBoringName(name) {
  if (!name) return false
  return BORING_NAME_PATTERNS.some(pattern => pattern.test(name))
}

// Get all types for a category
export function getTypesForCategory(categoryKey) {
  return GOOD_CATEGORIES[categoryKey]?.types || []
}

// Get all good types
export function getAllGoodTypes() {
  return Object.values(GOOD_CATEGORIES).flatMap(cat => cat.types)
}

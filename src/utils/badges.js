/**
 * Place Badges System
 *
 * Detects and displays badges for independent businesses,
 * historic sites, community favorites, and more.
 */

import { getAllRatings } from './ratingsStorage'

/**
 * Known chain names to exclude from "independent" badge
 */
const KNOWN_CHAINS = [
  // Coffee & Cafes
  'starbucks', 'costa', 'costa coffee', 'caffe nero', 'pret', 'pret a manger',
  'greggs', 'nero', 'coffee#1', 'caffe ritazza', 'caffè nero',

  // Fast Food
  'mcdonald\'s', 'mcdonalds', 'burger king', 'kfc', 'subway', 'domino\'s',
  'dominos', 'pizza hut', 'papa john\'s', 'papa johns', 'five guys',
  'nando\'s', 'nandos', 'wagamama', 'wahaca', 'itsu', 'wasabi', 'yo sushi',
  'leon', 'tortilla', 'chipotle',

  // Pubs & Restaurants
  'wetherspoons', 'wetherspoon', 'j d wetherspoon', 'greene king',
  'marstons', 'marston\'s', 'mitchells & butlers', 'harvester',
  'beefeater', 'brewers fayre', 'toby carvery', 'hungry horse',
  'stonehouse', 'miller & carter', 'all bar one', 'slug and lettuce',
  'revolution', 'walkabout', 'o\'neills', 'yates', 'be at one',
  'pizza express', 'zizzi', 'ask italian', 'bella italia', 'prezzo',
  'frankie & benny\'s', 'chiquito', 'tgi fridays', 'las iguanas',

  // Retail & Services
  'tesco', 'sainsbury\'s', 'sainsburys', 'asda', 'morrisons', 'lidl', 'aldi',
  'waitrose', 'marks & spencer', 'm&s', 'co-op', 'coop', 'spar', 'nisa',
  'londis', 'premier', 'one stop', 'costcutter', 'budgens',
  'boots', 'superdrug', 'holland & barrett', 'savers',
  'wh smith', 'whsmith', 'smiths',

  // Hotels
  'premier inn', 'travelodge', 'holiday inn', 'ibis', 'novotel',
  'hilton', 'marriott', 'best western', 'doubletree'
]

/**
 * Badge definitions with detection logic
 */
export const BADGE_DEFINITIONS = {
  independent: {
    id: 'independent',
    icon: '🏪',
    label: 'Independent',
    color: '#10b981',
    description: 'Locally owned, not a chain',
    priority: 1
  },
  historic: {
    id: 'historic',
    icon: '🏛️',
    label: 'Historic',
    color: '#8b5cf6',
    description: 'Listed or heritage site',
    priority: 2
  },
  community_favorite: {
    id: 'community_favorite',
    icon: '💛',
    label: 'Loved',
    color: '#f59e0b',
    description: 'Highly recommended by explorers',
    priority: 3
  },
  hidden_gem: {
    id: 'hidden_gem',
    icon: '💎',
    label: 'Hidden Gem',
    color: '#06b6d4',
    description: 'Undiscovered treasure',
    priority: 4
  },
  national_trust: {
    id: 'national_trust',
    icon: '🌳',
    label: 'National Trust',
    color: '#059669',
    description: 'National Trust property',
    priority: 5
  },
  dog_friendly: {
    id: 'dog_friendly',
    icon: '🐕',
    label: 'Dog Friendly',
    color: '#a78bfa',
    description: 'Dogs welcome',
    priority: 6
  },
  free_entry: {
    id: 'free_entry',
    icon: '🎟️',
    label: 'Free Entry',
    color: '#22c55e',
    description: 'No admission charge',
    priority: 7
  },
  outdoor: {
    id: 'outdoor',
    icon: '🌿',
    label: 'Outdoor',
    color: '#84cc16',
    description: 'Outdoor space or seating',
    priority: 8
  }
}

/**
 * Check if a place name matches a known chain
 * @param {string} name - Place name
 * @param {string} brand - Brand tag from OSM
 * @returns {boolean}
 */
function isKnownChain(name, brand) {
  const nameLower = (name || '').toLowerCase().trim()
  const brandLower = (brand || '').toLowerCase().trim()

  return KNOWN_CHAINS.some(chain => {
    return nameLower.includes(chain) ||
           nameLower === chain ||
           brandLower.includes(chain) ||
           brandLower === chain
  })
}

/**
 * Detect badges for a place based on its properties
 * @param {Object} place - Place object with OSM tags
 * @returns {string[]} Array of badge IDs
 */
export function detectBadges(place) {
  const badges = []
  const ratings = getAllRatings()
  const placeRating = ratings[place.id]

  // Independent business detection
  // Must be a food/drink/shop establishment without a known chain name
  const isCommercial = ['restaurant', 'cafe', 'pub', 'bar', 'shop', 'fast_food', 'bakery'].some(
    type => place.type?.includes(type) || place.amenity?.includes(type)
  )

  if (isCommercial && !place.brand && !isKnownChain(place.name, place.brand)) {
    badges.push('independent')
  }

  // Historic site detection
  if (place.heritage || place.listed_status || place.historic ||
      place.building === 'historic' || place.building === 'church' ||
      place.amenity === 'place_of_worship' && place.building === 'cathedral') {
    badges.push('historic')
  }

  // Community favorite - user rated highly
  if (placeRating && placeRating.recommended) {
    badges.push('community_favorite')
  }

  // National Trust detection
  const operator = (place.operator || '').toLowerCase()
  if (operator.includes('national trust') ||
      place.network?.toLowerCase().includes('national trust')) {
    badges.push('national_trust')
  }

  // Dog friendly detection
  if (place.dog === 'yes' || place.dogs === 'yes' ||
      place['dog:friendly'] === 'yes') {
    badges.push('dog_friendly')
  }

  // Free entry detection
  if (place.fee === 'no' || place.fee === '0' ||
      place.entrance === 'free' || place.charge === 'no') {
    badges.push('free_entry')
  }

  // Outdoor detection
  if (place.outdoor_seating === 'yes' || place.beer_garden === 'yes' ||
      place.garden === 'yes' || place.leisure === 'park' ||
      place.leisure === 'garden' || place.landuse === 'recreation_ground') {
    badges.push('outdoor')
  }

  // Hidden gem - place exists but hasn't been visited much (for future server-side)
  // For now, we'll base it on lack of rating which suggests it's undiscovered
  if (!placeRating && place.type &&
      !['park', 'viewpoint', 'artwork'].includes(place.type)) {
    // Only mark as hidden gem if it's been in our system
    // This is a placeholder for future server-side popularity tracking
  }

  return badges
}

/**
 * Get badge objects for a place
 * @param {Object} place - Place object
 * @returns {Object[]} Array of badge definition objects
 */
export function getPlaceBadges(place) {
  const badgeIds = detectBadges(place)

  return badgeIds
    .map(id => BADGE_DEFINITIONS[id])
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority)
}

/**
 * Filter places by required badges
 * @param {Object[]} places - Array of places
 * @param {string[]} requiredBadges - Badge IDs to filter by
 * @returns {Object[]} Filtered places
 */
export function filterByBadges(places, requiredBadges) {
  if (!requiredBadges || requiredBadges.length === 0) {
    return places
  }

  return places.filter(place => {
    const placeBadges = detectBadges(place)
    return requiredBadges.every(badge => placeBadges.includes(badge))
  })
}

/**
 * Get available badge filters with counts
 * @param {Object[]} places - Array of places to analyze
 * @returns {Object[]} Badge filters with counts
 */
export function getBadgeFilterOptions(places) {
  const counts = {}

  // Count badges across all places
  places.forEach(place => {
    const badges = detectBadges(place)
    badges.forEach(badge => {
      counts[badge] = (counts[badge] || 0) + 1
    })
  })

  // Return as filter options sorted by count
  return Object.entries(BADGE_DEFINITIONS)
    .filter(([id]) => counts[id] > 0)
    .map(([id, badge]) => ({
      ...badge,
      count: counts[id]
    }))
    .sort((a, b) => b.count - a.count)
}

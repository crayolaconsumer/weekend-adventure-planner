/**
 * Events-page constants. Filter chips, view modes, search radius,
 * category list, price brackets, sort order, and paging knobs.
 */

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'weekend', label: 'Weekend' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'free', label: 'Free' },
]

export const VIEW_MODES = {
  SWIPE: 'swipe',
  GRID: 'grid',
}

// Radius options in km
export const RADIUS_OPTIONS = [5, 10, 25, 50, 100]

// Category options
export const CATEGORIES = [
  { id: 'music', label: 'Music' },
  { id: 'comedy', label: 'Comedy' },
  { id: 'theatre', label: 'Theatre' },
  { id: 'sports', label: 'Sports' },
  { id: 'nightlife', label: 'Nightlife' },
  { id: 'food', label: 'Food & Drink' },
  { id: 'family', label: 'Family' },
  { id: 'culture', label: 'Culture' },
  { id: 'entertainment', label: 'Entertainment' },
]

// Price filter options
export const PRICE_OPTIONS = [
  { id: 'any', label: 'Any Price', maxPrice: null },
  { id: 'free', label: 'Free', maxPrice: 0 },
  { id: 'under20', label: 'Under £20', maxPrice: 20 },
  { id: 'under50', label: 'Under £50', maxPrice: 50 },
]

export const SORT_OPTIONS = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'soonest', label: 'Soonest' },
  { id: 'nearest', label: 'Nearest' },
  { id: 'popular', label: 'Popular' },
]

// Page size for loading events incrementally
export const EVENTS_PAGE_SIZE = 20
export const EVENTS_LOAD_MORE_THRESHOLD = 10

/**
 * Events-page constants. Filter chips, view modes, search radius,
 * category list, price brackets, sort order, and paging knobs.
 */

export interface Filter {
  id: string
  label: string
}

export const FILTERS: Filter[] = [
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
} as const

export type ViewMode = typeof VIEW_MODES[keyof typeof VIEW_MODES]

// Radius options in km
export const RADIUS_OPTIONS: number[] = [5, 10, 25, 50, 100]

export interface EventCategory {
  id: string
  label: string
}

export const CATEGORIES: EventCategory[] = [
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

export interface PriceOption {
  id: string
  label: string
  maxPrice: number | null
}

export const PRICE_OPTIONS: PriceOption[] = [
  { id: 'any', label: 'Any Price', maxPrice: null },
  { id: 'free', label: 'Free', maxPrice: 0 },
  { id: 'under20', label: 'Under £20', maxPrice: 20 },
  { id: 'under50', label: 'Under £50', maxPrice: 50 },
]

export interface SortOption {
  id: string
  label: string
}

export const SORT_OPTIONS: SortOption[] = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'soonest', label: 'Soonest' },
  { id: 'nearest', label: 'Nearest' },
  { id: 'popular', label: 'Popular' },
]

export const EVENTS_PAGE_SIZE = 20
export const EVENTS_LOAD_MORE_THRESHOLD = 10

/**
 * Plan-page constants — vibe / duration / transport / radius pickers
 * plus the icon lookup used by the summary card.
 */

export const VIBES = [
  { key: 'mixed', label: 'Mix', categories: null },
  { key: 'foodie', label: 'Food', categories: ['food', 'nightlife'] },
  { key: 'culture', label: 'Culture', categories: ['culture', 'historic'] },
  { key: 'nature', label: 'Outdoor', categories: ['nature', 'active'] },
]

export const DURATIONS = [
  { hours: 2, label: '2h', stops: 2 },
  { hours: 4, label: 'Half Day', stops: 3 },
  { hours: 6, label: 'Full Day', stops: 4 },
  { hours: 8, label: 'Epic', stops: 5 },
]

// Transport modes with average speeds (km/h) accounting for urban conditions
export const TRANSPORT_MODES = [
  { key: 'walk', label: 'Walking', speed: 5, icon: '🚶' },
  { key: 'transit', label: 'Transit', speed: 25, icon: '🚇' },
  { key: 'drive', label: 'Driving', speed: 35, icon: '🚗' },
]

// Search radius options
export const RADIUS_OPTIONS = [
  { key: 'nearby', label: 'Nearby', radius: 5000, description: '5km' },
  { key: 'local', label: 'Local', radius: 10000, description: '10km' },
  { key: 'area', label: 'Area', radius: 25000, description: '25km' },
  { key: 'daytrip', label: 'Day Trip', radius: 50000, description: '50km' },
]

// Vibe icons for the summary card
export const VIBE_ICONS = {
  mixed: '🎲',
  foodie: '🍽️',
  culture: '🏛️',
  nature: '🌲',
}

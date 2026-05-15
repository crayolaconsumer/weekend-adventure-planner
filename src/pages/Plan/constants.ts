/**
 * Plan-page constants — vibe / duration / transport / radius pickers
 * plus the icon lookup used by the summary card.
 */

export interface Vibe {
  key: 'mixed' | 'foodie' | 'culture' | 'nature'
  label: string
  categories: string[] | null
}

export interface Duration {
  hours: number
  label: string
  stops: number
}

export interface TransportMode {
  key: 'walk' | 'transit' | 'drive'
  label: string
  speed: number
}

export interface RadiusOption {
  key: 'nearby' | 'local' | 'area' | 'daytrip'
  label: string
  radius: number
  description: string
}

export const VIBES: Vibe[] = [
  { key: 'mixed', label: 'Mix', categories: null },
  { key: 'foodie', label: 'Food', categories: ['food', 'nightlife'] },
  { key: 'culture', label: 'Culture', categories: ['culture', 'historic'] },
  { key: 'nature', label: 'Outdoor', categories: ['nature', 'active'] },
]

export const DURATIONS: Duration[] = [
  { hours: 2, label: '2h', stops: 2 },
  { hours: 4, label: 'Half Day', stops: 3 },
  { hours: 6, label: 'Full Day', stops: 4 },
  { hours: 8, label: 'Epic', stops: 5 },
]

export const TRANSPORT_MODES: TransportMode[] = [
  { key: 'walk', label: 'Walking', speed: 5 },
  { key: 'transit', label: 'Transit', speed: 25 },
  { key: 'drive', label: 'Driving', speed: 35 },
]

export const RADIUS_OPTIONS: RadiusOption[] = [
  { key: 'nearby', label: 'Nearby', radius: 5000, description: '5km' },
  { key: 'local', label: 'Local', radius: 10000, description: '10km' },
  { key: 'area', label: 'Area', radius: 25000, description: '25km' },
  { key: 'daytrip', label: 'Day Trip', radius: 50000, description: '50km' },
]


/**
 * Discover-page constants.
 *
 * TRAVEL_MODES feed the radius picker — `premium: true` modes are
 * gated behind ROAM+ via useSubscription.
 */

export interface TravelMode {
  label: string
  icon: string
  maxRadius: number
  speed: number
  premium?: boolean
}

export const TRAVEL_MODES: Record<string, TravelMode> = {
  // Standard modes (all users)
  walking: { label: 'Walking', icon: '🚶', maxRadius: 5000, speed: 5 },
  driving: { label: 'Driving', icon: '🚗', maxRadius: 30000, speed: 40 },
  transit: { label: 'Transit', icon: '🚌', maxRadius: 15000, speed: 20 },
  // Premium modes (ROAM+ only)
  dayTrip: { label: 'Day Trip', icon: '🗺️', maxRadius: 75000, speed: 60, premium: true },
  explorer: { label: 'Explorer', icon: '🧭', maxRadius: 150000, speed: 80, premium: true },
}

// Default fallback location (London, UK)
export const DEFAULT_LOCATION = { lat: 51.5074, lng: -0.1278 } as const

export const LOCATION_TIMEOUT_MS = 15000 // 15 seconds

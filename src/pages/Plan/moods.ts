/**
 * Mood-first generation — six chips that prime the planner with the
 * user's *feeling* rather than asking them to choose a vibe, duration
 * and radius up front. Each mood maps to a soft override over the
 * generator's existing knobs: a vibe key, a category bias, a duration
 * cap, and an "energy curve" for stop pacing.
 *
 * Picked moods deliberately overlap so the user feels seen no matter
 * what tap they reach for first. Cozy ↔ Restful and Adventurous ↔
 * Energised differ in pace, not category.
 */

export type MoodKey = 'cozy' | 'curious' | 'energised' | 'restful' | 'adventurous' | 'hungry'

export interface MoodOverride {
  key: MoodKey
  label: string
  /** Single-emoji-style short blurb shown under the chip. */
  blurb: string
  /** Default vibe this mood maps to. */
  vibe: 'mixed' | 'foodie' | 'culture' | 'nature'
  /** Recommended duration in hours. */
  durationHours: number
  /** Recommended radius option (matches RADIUS_OPTIONS.key). */
  radius: 'nearby' | 'local' | 'area' | 'daytrip'
  /** Recommended transport mode (matches TRANSPORT_MODES.key). */
  transport: 'walk' | 'transit' | 'drive'
}

export const MOODS: MoodOverride[] = [
  {
    key: 'cozy',
    label: 'Cozy',
    blurb: 'Bookshops, cafés, quiet corners',
    vibe: 'mixed',
    durationHours: 4,
    radius: 'nearby',
    transport: 'walk',
  },
  {
    key: 'curious',
    label: 'Curious',
    blurb: 'Museums, history, hidden things',
    vibe: 'culture',
    durationHours: 4,
    radius: 'local',
    transport: 'walk',
  },
  {
    key: 'energised',
    label: 'Energised',
    blurb: 'Movement, music, full day',
    vibe: 'mixed',
    durationHours: 6,
    radius: 'area',
    transport: 'drive',
  },
  {
    key: 'restful',
    label: 'Restful',
    blurb: 'Parks, gardens, slow stops',
    vibe: 'nature',
    durationHours: 4,
    radius: 'nearby',
    transport: 'walk',
  },
  {
    key: 'adventurous',
    label: 'Adventurous',
    blurb: 'Further afield, off the beaten path',
    vibe: 'mixed',
    durationHours: 8,
    radius: 'daytrip',
    transport: 'drive',
  },
  {
    key: 'hungry',
    label: 'Hungry',
    blurb: 'Food first, everything else around it',
    vibe: 'foodie',
    durationHours: 2,
    radius: 'nearby',
    transport: 'walk',
  },
]

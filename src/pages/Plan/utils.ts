/**
 * Auth token retrieval — matches the storage keys used everywhere else
 * in the app (localStorage primary, sessionStorage fallback).
 */
export function getAuthToken(): string | null {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

/**
 * Parse a stop's scheduled time into a JS Date.
 *
 * The Plan page stores newly-generated stops as full ISO datetimes
 * (e.g. "2026-05-16T10:00:00.000Z"). However the `plan_stops` MySQL
 * column is a TIME type ("10:00:00") — so when a saved plan is
 * reopened via /api/plans/:id, the time arrives as a TIME-only
 * string. `new Date("10:00:00")` is "Invalid Date" on every browser,
 * which would render literally as "Invalid Date" on the stop card.
 *
 * This helper handles both shapes: full ISO passes through, TIME-only
 * gets stitched onto today's date so the day's itinerary still shows
 * meaningful times relative to "right now".
 */
export function parseScheduledTime(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const str = String(value)
  // Already a full datetime (ISO or timezone-aware) — let Date parse it.
  if (str.includes('T') || str.includes(' ')) {
    const d = new Date(str)
    return Number.isNaN(d.getTime()) ? null : d
  }
  // TIME-only "HH:MM[:SS]" — stitch onto today's date.
  const match = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (match) {
    const [, hh, mm, ss] = match
    const d = new Date()
    d.setHours(parseInt(hh, 10) || 0, parseInt(mm, 10) || 0, parseInt(ss || '0', 10) || 0, 0)
    return d
  }
  // Last-ditch: let Date try, return null if it fails.
  const fallback = new Date(str)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

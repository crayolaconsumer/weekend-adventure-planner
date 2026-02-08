/**
 * Opening Hours Intelligence
 *
 * Parses OSM opening_hours format and provides rich status information
 * using the opening_hours.js library (99.3% coverage of OSM values).
 */

import OpeningHours from 'opening_hours'

/**
 * Preprocess opening hours string to remove unsupported holiday references
 * The opening_hours.js library only has school holiday (SH) data for Germany,
 * so we strip these references to prevent parsing errors for other countries.
 * @param {string} hoursString - OSM opening_hours format string
 * @returns {string} - Cleaned opening hours string
 */
function preprocessHoursString(hoursString) {
  if (!hoursString) return hoursString

  // Remove standalone SH rules (e.g., "SH 11:00-16:00" or "SH off")
  // but keep the rest of the string
  let cleaned = hoursString
    // Remove "SH time-time" patterns (school holiday specific hours)
    .replace(/;?\s*SH\s+\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/gi, '')
    // Remove "SH off" or "SH closed"
    .replace(/;?\s*SH\s+(off|closed)/gi, '')
    // Remove standalone "SH" with semicolons
    .replace(/;?\s*SH\s*;/gi, ';')
    // Clean up any double semicolons or trailing semicolons
    .replace(/;+/g, ';')
    .replace(/^;|;$/g, '')
    .trim()

  return cleaned || hoursString // Return original if we stripped everything
}

/**
 * Parse opening hours string with location context
 * @param {string} hoursString - OSM opening_hours format string
 * @param {Object} place - Place object with lat/lng
 * @returns {OpeningHours|null} - Parsed opening hours object or null if invalid
 */
export function parseOpeningHours(hoursString, place) {
  if (!hoursString || typeof hoursString !== 'string') {
    return null
  }

  // Preprocess to remove unsupported SH (school holiday) references
  const cleanedHours = preprocessHoursString(hoursString)

  try {
    // Nominatim-style location data for holiday/timezone awareness
    const nominatim = place?.lat && place?.lng ? {
      lat: place.lat,
      lon: place.lng,
      address: {
        country_code: 'gb' // Default to UK
      }
    } : null

    return new OpeningHours(cleanedHours, nominatim, {
      locale: 'en-GB'
    })
  } catch (error) {
    // Many OSM entries have malformed hours - this is expected
    // Silently fail - don't log as these are common and expected
    return null
  }
}

/**
 * Format time for display
 * @param {Date} date
 * @returns {string}
 */
function formatTime(date) {
  return date.toLocaleTimeString('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).replace(':00', '')
}

/**
 * Format next opening time
 * @param {OpeningHours} oh - Parsed opening hours
 * @param {Date} now - Current time
 * @returns {string}
 */
function formatNextOpen(oh, now) {
  try {
    const nextChange = oh.getNextChange(now)
    if (!nextChange) return 'Check times'

    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)

    const isToday = nextChange < tomorrow
    const dayLabel = isToday ? '' : nextChange.toLocaleDateString('en-GB', { weekday: 'short' }) + ' '

    return `${dayLabel}${formatTime(nextChange)}`
  } catch {
    return 'Check times'
  }
}

/**
 * Opening state types
 * @typedef {'open' | 'closed' | 'closing_soon' | 'opening_soon' | 'unknown'} OpeningState
 */

/**
 * Get comprehensive opening status for a place
 * @param {string} hoursString - OSM opening_hours format string
 * @param {Object} place - Place object with lat/lng
 * @returns {Object} Opening state information
 */
export function getOpeningState(hoursString, place) {
  // Handle missing or empty hours
  if (!hoursString) {
    return {
      state: 'unknown',
      stateLabel: 'Hours unknown',
      nextChange: null,
      isHoliday: false,
      rawHours: null
    }
  }

  // Quick check for 24/7 places (optimization)
  const normalized = hoursString.toLowerCase().trim()
  if (normalized === '24/7' || normalized === '24 hours') {
    return {
      state: 'open',
      stateLabel: 'Open 24/7',
      nextChange: null,
      isHoliday: false,
      rawHours: hoursString
    }
  }

  const oh = parseOpeningHours(hoursString, place)
  if (!oh) {
    return {
      state: 'unknown',
      stateLabel: 'Hours unknown',
      nextChange: null,
      isHoliday: false,
      rawHours: hoursString
    }
  }

  try {
    const now = new Date()
    const isOpen = oh.getState(now)
    const nextChange = oh.getNextChange(now)

    // Calculate minutes until next change
    const minutesUntilChange = nextChange
      ? Math.floor((nextChange.getTime() - now.getTime()) / 60000)
      : null

    // Check for holiday status
    let isHoliday = false
    try {
      const comment = oh.getComment(now)
      isHoliday = comment?.toLowerCase().includes('holiday') || false
    } catch {
      // getComment might not be available in all versions
    }

    // Determine state based on open/closed and time until change
    if (isOpen) {
      if (minutesUntilChange !== null && minutesUntilChange <= 30) {
        return {
          state: 'closing_soon',
          stateLabel: minutesUntilChange <= 5
            ? 'Closing now'
            : `Closes in ${minutesUntilChange}m`,
          nextChange,
          isHoliday,
          rawHours: hoursString
        }
      }

      return {
        state: 'open',
        stateLabel: 'Open now',
        nextChange,
        isHoliday,
        rawHours: hoursString
      }
    }

    // Closed
    if (minutesUntilChange !== null && minutesUntilChange <= 60) {
      return {
        state: 'opening_soon',
        stateLabel: `Opens at ${formatTime(nextChange)}`,
        nextChange,
        isHoliday,
        rawHours: hoursString
      }
    }

    return {
      state: 'closed',
      stateLabel: `Closed · Opens ${formatNextOpen(oh, now)}`,
      nextChange,
      isHoliday,
      rawHours: hoursString
    }
  } catch (error) {
    console.debug('Error getting opening state:', error)
    return {
      state: 'unknown',
      stateLabel: 'Hours unknown',
      nextChange: null,
      isHoliday: false,
      rawHours: hoursString
    }
  }
}

/**
 * Check if a place is currently open
 * @param {Object} place - Place object with openingHours and lat/lng
 * @returns {boolean|null} - true if open, false if closed, null if unknown
 */
export function isPlaceOpen(place) {
  const state = getOpeningState(place?.openingHours || place?.opening_hours, place)

  if (state.state === 'unknown') return null
  return state.state === 'open' || state.state === 'closing_soon'
}

/**
 * Get a formatted opening hours schedule for display
 * @param {string} hoursString - OSM opening_hours format
 * @param {Object} place - Place object
 * @returns {Array<{day: string, hours: string}>|null}
 */
export function getWeeklySchedule(hoursString, place) {
  const oh = parseOpeningHours(hoursString, place)
  if (!oh) return null

  try {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    const schedule = []

    // Get a date for each day of the current week
    const now = new Date()
    const currentDay = now.getDay() // 0 = Sunday
    const monday = new Date(now)
    monday.setDate(now.getDate() - (currentDay === 0 ? 6 : currentDay - 1))
    monday.setHours(0, 0, 0, 0)

    for (let i = 0; i < 7; i++) {
      const date = new Date(monday)
      date.setDate(monday.getDate() + i)

      // Get intervals for this day
      const dayStart = new Date(date)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(date)
      dayEnd.setHours(23, 59, 59, 999)

      const intervals = oh.getOpenIntervals(dayStart, dayEnd)

      if (intervals.length === 0) {
        schedule.push({ day: days[i], hours: 'Closed' })
      } else {
        const hoursStr = intervals
          .map(([start, end]) => `${formatTime(start)} - ${formatTime(end)}`)
          .join(', ')
        schedule.push({ day: days[i], hours: hoursStr })
      }
    }

    return schedule
  } catch (error) {
    console.debug('Error getting weekly schedule:', error)
    return null
  }
}

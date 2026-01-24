/**
 * Saved Events Storage Utility
 *
 * CRUD operations for saved/liked events.
 * Persists to localStorage, similar to places wishlist.
 */

const STORAGE_KEY = 'roam_saved_events'

/**
 * Get all saved events
 * @returns {Object[]} Array of saved event objects
 */
export function getSavedEvents() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return []

    const parsed = JSON.parse(saved)

    // Validate that we have an array
    if (!Array.isArray(parsed)) {
      console.warn('Saved events data was not an array, resetting')
      localStorage.removeItem(STORAGE_KEY)
      return []
    }

    // Filter out any invalid entries (missing required fields)
    return parsed.filter(event =>
      event && typeof event === 'object' && event.id
    )
  } catch (error) {
    console.error('Error reading saved events:', error)
    // If localStorage is corrupted, clear it and return empty
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Ignore localStorage errors
    }
    return []
  }
}

/**
 * Save an event
 * @param {Object} event - Event object to save
 */
export function saveEvent(event) {
  if (!event || !event.id) return false

  try {
    const saved = getSavedEvents()

    // Check if already saved
    if (saved.some(e => e.id === event.id)) {
      return true // Already saved
    }

    // Add savedAt timestamp
    const eventToSave = {
      ...event,
      savedAt: Date.now()
    }

    saved.unshift(eventToSave) // Add to beginning
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    return true
  } catch (error) {
    console.error('Error saving event:', error)
    return false
  }
}

/**
 * Remove an event from saved
 * @param {string} eventId - Event ID to remove
 */
export function unsaveEvent(eventId) {
  try {
    const saved = getSavedEvents()
    const filtered = saved.filter(e => e.id !== eventId)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
    return true
  } catch (error) {
    console.error('Error removing saved event:', error)
    return false
  }
}

/**
 * Check if an event is saved
 * @param {string} eventId - Event ID to check
 * @returns {boolean}
 */
export function isEventSaved(eventId) {
  const saved = getSavedEvents()
  return saved.some(e => e.id === eventId)
}

/**
 * Toggle save status for an event
 * @param {Object} event - Event object
 * @returns {boolean} New saved status
 */
export function toggleSaveEvent(event) {
  if (isEventSaved(event.id)) {
    unsaveEvent(event.id)
    return false
  } else {
    saveEvent(event)
    return true
  }
}

/**
 * Get count of saved events
 * @returns {number}
 */
export function getSavedCount() {
  return getSavedEvents().length
}

/**
 * Clear all saved events
 */
export function clearSavedEvents() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    return true
  } catch (error) {
    console.error('Error clearing saved events:', error)
    return false
  }
}

/**
 * Get saved events filtered by upcoming only
 * @returns {Object[]} Events that haven't passed yet
 */
export function getUpcomingSavedEvents() {
  const saved = getSavedEvents()
  const now = new Date()

  return saved.filter(event => {
    if (!event.datetime?.start) return true // Keep if no date
    const eventDate = new Date(event.datetime.start)
    return eventDate >= now
  })
}

/**
 * Get saved events sorted by date
 * @param {string} order - 'asc' or 'desc'
 * @returns {Object[]}
 */
export function getSavedEventsSorted(order = 'asc') {
  const saved = getSavedEvents()

  return saved.sort((a, b) => {
    const dateA = a.datetime?.start ? new Date(a.datetime.start) : new Date(0)
    const dateB = b.datetime?.start ? new Date(b.datetime.start) : new Date(0)
    return order === 'asc' ? dateA - dateB : dateB - dateA
  })
}

export default {
  getSavedEvents,
  saveEvent,
  unsaveEvent,
  isEventSaved,
  toggleSaveEvent,
  getSavedCount,
  clearSavedEvents,
  getUpcomingSavedEvents,
  getSavedEventsSorted
}

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
    return saved ? JSON.parse(saved) : []
  } catch (error) {
    console.error('Error reading saved events:', error)
    return []
  }
}

/**
 * Save an event
 * @param {Object} event - Event object to save
 */
export function saveEvent(event) {
  if (!event || !event.id) return

  const saved = getSavedEvents()

  // Check if already saved
  if (saved.some(e => e.id === event.id)) {
    return // Already saved
  }

  // Add savedAt timestamp
  const eventToSave = {
    ...event,
    savedAt: Date.now()
  }

  saved.unshift(eventToSave) // Add to beginning
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
}

/**
 * Remove an event from saved
 * @param {string} eventId - Event ID to remove
 */
export function unsaveEvent(eventId) {
  const saved = getSavedEvents()
  const filtered = saved.filter(e => e.id !== eventId)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
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
  localStorage.removeItem(STORAGE_KEY)
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

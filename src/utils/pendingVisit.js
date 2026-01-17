/**
 * Utilities for managing pending visit prompts
 * (when user navigates to a place and returns to the app)
 */

// Check for pending visit prompts
export function getPendingVisit() {
  try {
    const pending = localStorage.getItem('roam_pending_visit')
    if (!pending) return null

    const data = JSON.parse(pending)
    const elapsed = Date.now() - data.timestamp

    // Only show if 5+ minutes have passed and less than 24 hours
    if (elapsed > 5 * 60 * 1000 && elapsed < 24 * 60 * 60 * 1000) {
      return data.place
    }

    // Clear if too old
    if (elapsed >= 24 * 60 * 60 * 1000) {
      localStorage.removeItem('roam_pending_visit')
    }

    return null
  } catch {
    return null
  }
}

// Save a place as pending visit
export function setPendingVisit(place) {
  try {
    localStorage.setItem('roam_pending_visit', JSON.stringify({
      place,
      timestamp: Date.now()
    }))
  } catch {
    // Storage not available
  }
}

// Clear pending visit
export function clearPendingVisit() {
  try {
    localStorage.removeItem('roam_pending_visit')
  } catch {
    // Storage not available
  }
}

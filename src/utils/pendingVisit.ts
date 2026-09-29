/**
 * Utilities for managing pending visit prompts
 * (when user navigates to a place and returns to the app)
 */

export interface PendingPlace {
  id: string | number
  name: string
  [key: string]: unknown
}

interface PendingVisitRecord {
  place: PendingPlace
  timestamp: number
}

// Check for pending visit prompts. The 30s grace keeps a fresh page load
// from prompting seconds after the GO swipe; the visibility-return path
// passes minElapsedMs: 0 because coming back from Maps IS the signal.
export function getPendingVisit(options: { minElapsedMs?: number } = {}): PendingPlace | null {
  const minElapsed = options.minElapsedMs ?? 30 * 1000
  try {
    const pending = localStorage.getItem('roam_pending_visit')
    if (!pending) return null

    const data = JSON.parse(pending) as PendingVisitRecord
    const elapsed = Date.now() - data.timestamp

    // Only show if minElapsed has passed and less than 24 hours
    if (elapsed >= minElapsed && elapsed < 24 * 60 * 60 * 1000) {
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
export function setPendingVisit(place: PendingPlace): void {
  try {
    localStorage.setItem('roam_pending_visit', JSON.stringify({
      place,
      timestamp: Date.now(),
    }))
  } catch {
    // Storage not available
  }
}

// Clear pending visit
export function clearPendingVisit(): void {
  try {
    localStorage.removeItem('roam_pending_visit')
  } catch {
    // Storage not available
  }
}

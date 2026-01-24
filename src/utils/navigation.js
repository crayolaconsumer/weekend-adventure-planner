/**
 * Navigation Utilities
 * Handles opening external links, especially maps/directions
 */

/**
 * Detect if running on a mobile device
 */
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  )
}

/**
 * Open Google Maps directions to a location
 * On mobile: Uses location.href to properly trigger native Maps app
 * On desktop: Opens in new tab
 *
 * @param {number} lat - Destination latitude
 * @param {number} lng - Destination longitude
 * @param {string} [name] - Optional place name for better UX
 */
export function openDirections(lat, lng, name = null) {
  // Build the URL with optional place name for better display
  let url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
  if (name) {
    url += `&destination_place_id=${encodeURIComponent(name)}`
  }

  if (isMobileDevice()) {
    // On mobile, navigate in same window to properly trigger native app
    // The user will return to our app via browser history/back
    window.location.href = url
  } else {
    // On desktop, open in new tab
    window.open(url, '_blank')
  }
}

/**
 * Open a URL in a new tab (for non-navigation links)
 * @param {string} url - URL to open
 */
export function openExternalLink(url) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

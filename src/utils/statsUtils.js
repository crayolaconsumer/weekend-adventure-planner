/**
 * Stats Utilities - Helper functions for stats dashboard
 */

/**
 * Calculate distance between two coordinates in km (Haversine formula)
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371 // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

/**
 * Format distance for display
 */
export function formatDistance(km) {
  if (km < 1) {
    return `${Math.round(km * 1000)}m`
  }
  return `${km.toFixed(1)}km`
}

/**
 * Get visited places from localStorage
 */
export function getVisitedPlaces() {
  try {
    return JSON.parse(localStorage.getItem('roam_visited_places') || '[]')
  } catch {
    return []
  }
}

/**
 * Save a visited place
 */
export function saveVisitedPlace(place, userLocation, rating = null) {
  const visitedPlaces = getVisitedPlaces()

  // Calculate distance if user location available
  let distance = null
  if (userLocation?.lat && userLocation?.lng && place.lat && place.lng) {
    distance = calculateDistance(
      userLocation.lat,
      userLocation.lng,
      place.lat,
      place.lng
    )
  }

  const visitedPlace = {
    id: place.id,
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    category: place.category?.key || place.type || 'unknown',
    distance,
    visitedAt: new Date().toISOString(),
    rating
  }

  // Check if already visited (avoid duplicates)
  const existingIndex = visitedPlaces.findIndex(p => p.id === place.id)
  if (existingIndex >= 0) {
    // Update existing entry
    visitedPlaces[existingIndex] = {
      ...visitedPlaces[existingIndex],
      ...visitedPlace,
      visitedAt: visitedPlaces[existingIndex].visitedAt // Keep original visit date
    }
  } else {
    visitedPlaces.push(visitedPlace)
  }

  localStorage.setItem('roam_visited_places', JSON.stringify(visitedPlaces))

  // Update distance stats
  if (distance !== null) {
    updateDistanceStats(distance)
  }

  return visitedPlace
}

/**
 * Update distance stats in roam_stats
 */
function updateDistanceStats(distance) {
  const stats = JSON.parse(localStorage.getItem('roam_stats') || '{}')

  stats.totalDistanceKm = (stats.totalDistanceKm || 0) + distance
  stats.longestTripKm = Math.max(stats.longestTripKm || 0, distance)
  stats.shortestTripKm = stats.shortestTripKm === undefined
    ? distance
    : Math.min(stats.shortestTripKm, distance)

  localStorage.setItem('roam_stats', JSON.stringify(stats))
}

/**
 * Aggregate visited places by category
 */
export function aggregateByCategory(visitedPlaces) {
  const categories = {}

  for (const place of visitedPlaces) {
    const cat = place.category || 'unknown'
    if (!categories[cat]) {
      categories[cat] = { count: 0, totalDistance: 0 }
    }
    categories[cat].count++
    if (place.distance) {
      categories[cat].totalDistance += place.distance
    }
  }

  // Convert to array sorted by count
  return Object.entries(categories)
    .map(([key, data]) => ({ category: key, ...data }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Aggregate visits by month
 */
export function aggregateByMonth(visitedPlaces, monthsBack = 6) {
  const now = new Date()
  const months = []

  // Generate last N months
  for (let i = monthsBack - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      label: date.toLocaleDateString('en-GB', { month: 'short' }),
      year: date.getFullYear(),
      month: date.getMonth(),
      count: 0
    })
  }

  // Count visits per month
  for (const place of visitedPlaces) {
    if (!place.visitedAt) continue

    const date = new Date(place.visitedAt)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const month = months.find(m => m.key === key)
    if (month) {
      month.count++
    }
  }

  return months
}

/**
 * Get bounding box for a set of coordinates
 */
export function getBoundingBox(places) {
  if (!places.length) return null

  let minLat = Infinity, maxLat = -Infinity
  let minLng = Infinity, maxLng = -Infinity

  for (const place of places) {
    if (place.lat && place.lng) {
      minLat = Math.min(minLat, place.lat)
      maxLat = Math.max(maxLat, place.lat)
      minLng = Math.min(minLng, place.lng)
      maxLng = Math.max(maxLng, place.lng)
    }
  }

  if (minLat === Infinity) return null

  return { minLat, maxLat, minLng, maxLng }
}

/**
 * Calculate stats summary
 */
export function calculateStatsSummary(visitedPlaces) {
  const stats = JSON.parse(localStorage.getItem('roam_stats') || '{}')

  return {
    totalPlaces: visitedPlaces.length,
    totalDistanceKm: stats.totalDistanceKm || 0,
    longestTripKm: stats.longestTripKm || 0,
    shortestTripKm: stats.shortestTripKm || 0,
    averageDistanceKm: visitedPlaces.length > 0 && stats.totalDistanceKm
      ? stats.totalDistanceKm / visitedPlaces.length
      : 0
  }
}

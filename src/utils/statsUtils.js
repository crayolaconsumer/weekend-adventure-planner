/**
 * Stats Utilities - Helper functions for stats dashboard
 */

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

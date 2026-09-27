/**
 * Text for the map route chip. Pure so it can be tested.
 */

export function formatDuration(minutes) {
  const m = Math.max(1, Math.round(minutes || 0))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} hr ${rest} min` : `${h} hr`
}

/**
 * Chip text for a route state. Pure so it can be tested.
 * @returns {{ main: string, note: string|null }}
 */
export function routeSummary(route, formatDistance = (km) => `${km} km`) {
  if (!route) return { main: '', note: null }
  if (route.status === 'loading') return { main: 'Finding route…', note: null }
  if (route.status === 'error') return { main: route.message, note: null }
  const how = route.shownMode === 'drive' ? 'drive' : 'walk'
  const time = formatDuration(route.duration)
  if (!route.positions) {
    return { main: `About ${time} ${how}`, note: 'Straight-line estimate, route unavailable' }
  }
  const main = `${time} ${how} · ${formatDistance(route.distance)}`
  const note = route.mode === 'transit' ? 'Walking route shown. Bus and train times are in Maps.' : null
  return { main, note }
}

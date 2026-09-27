/**
 * Why I'm Bored picked a place, as short specific lines ("Only 400 m away",
 * "Open now", "Matches your interest in culture") rather than a generic
 * "Popular Food & Drink". JustGoModal maps each `kind` to an icon.
 */

import { getOpeningState } from './openingHours'
import { weatherVerdict } from './placeFilter'

const OUTDOOR = ['nature', 'active', 'entertainment']

/**
 * @param {object} place - enhanced place (distance in km, category object)
 * @param {object} ctx
 * @param {object} [ctx.weather]
 * @param {(km: number) => string} ctx.formatDistance
 * @param {string[]} [ctx.interests] - category keys the user picked or favours
 * @param {Date} [ctx.now]
 * @returns {{kind: string, text: string}[]} at most three reasons
 */
export function getJustGoReasons(place, { weather, formatDistance, interests = [], now = new Date() } = {}) {
  const reasons = []
  const category = place?.category

  // Distance is in km (enhancePlace). Always the most useful fact.
  if (typeof place?.distance === 'number' && formatDistance) {
    const where = formatDistance(place.distance)
    reasons.push({ kind: 'distance', text: place.distance < 5 ? `Only ${where} away` : `${where} away` })
  }

  const opening = getOpeningState(place?.openingHours || place?.opening_hours, place)
  if (opening.state === 'open') reasons.push({ kind: 'open', text: 'Open now' })
  else if (opening.state === 'closing_soon') reasons.push({ kind: 'open', text: `Open now, ${opening.stateLabel.toLowerCase()}` })

  if (category?.key && interests.includes(category.key)) {
    reasons.push({ kind: 'match', text: `Matches your interest in ${category.label.toLowerCase()}` })
  }

  // Weather, only from real weather: indoor copy when it is wet or cold,
  // outdoor copy when it is fine, nothing when weather is unknown.
  const isOutdoor = OUTDOOR.includes(category?.key)
  const verdict = weatherVerdict(weather)
  if (verdict === 'fine' && isOutdoor) {
    reasons.push({ kind: 'sun', text: 'Good weather for this' })
  } else if ((verdict === 'wet' || verdict === 'cold') && category && !isOutdoor) {
    reasons.push({ kind: 'indoor', text: verdict === 'wet' ? 'Good indoor option while it rains' : 'Good indoor option on a cold day' })
  }

  const hour = now.getHours()
  if (category?.key === 'food' && hour >= 11 && hour <= 14) reasons.push({ kind: 'lunch', text: 'Good for lunch' })
  else if (category?.key === 'food' && hour >= 18) reasons.push({ kind: 'dinner', text: 'Good for dinner' })

  if (place?.rating >= 4.5) reasons.push({ kind: 'rating', text: 'Highly rated' })

  return reasons.slice(0, 3)
}

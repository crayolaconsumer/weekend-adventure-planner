/**
 * Place Badges Component
 *
 * Displays badges for places like Independent, Historic, Dog Friendly, etc.
 */

import { getPlaceBadges } from '../utils/badges'
import './PlaceBadges.css'

export default function PlaceBadges({ place, variant = 'compact', maxVisible = 3 }) {
  const badges = getPlaceBadges(place)

  if (badges.length === 0) {
    return null
  }

  const visibleBadges = badges.slice(0, maxVisible)
  const overflowCount = badges.length - maxVisible

  return (
    <div className={`place-badges place-badges-${variant}`}>
      {visibleBadges.map(badge => (
        <span
          key={badge.id}
          className="place-badge"
          style={{ '--badge-color': badge.color }}
          title={badge.description}
        >
          <span className="place-badge-icon">{badge.icon}</span>
          {variant === 'full' && (
            <span className="place-badge-label">{badge.label}</span>
          )}
        </span>
      ))}
      {overflowCount > 0 && (
        <span className="place-badge place-badge-overflow">
          +{overflowCount}
        </span>
      )}
    </div>
  )
}

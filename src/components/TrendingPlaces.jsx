/**
 * TrendingPlaces
 *
 * Horizontal-scroll card row of places trending in the community over
 * the last 30 days. Replaces the legacy stat-list (rank + fire emoji
 * + count) with proper place cards using the same PlaceImage chain as
 * the rest of the app — real photos when known, Wikipedia thumbnail
 * via the wikipedia/wikidata tag, brand-coloured stylized placeholder
 * otherwise. No iconic landmark photos as fallbacks.
 *
 * Hides itself when empty so the section disappears entirely instead
 * of showing an empty header.
 */

import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useTrendingPlaces } from '../hooks/useTrendingPlaces'
import PlaceImage from './PlaceImage'
import './TrendingPlaces.css'

const TrendingIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </svg>
)

// Format a single human activity stat per card. We don't show "5 fire"
// because nobody knows what that means. Pick the strongest signal:
//   visits > saves > contributions
function formatActivity(item) {
  if (item.visitCount > 0) {
    return item.visitCount === 1 ? '1 person visited' : `${item.visitCount} people visited`
  }
  if (item.saveCount > 0) {
    return item.saveCount === 1 ? '1 person saved' : `${item.saveCount} people saved`
  }
  if (item.contributionCount > 0) {
    return item.contributionCount === 1 ? '1 tip shared' : `${item.contributionCount} tips shared`
  }
  return null
}

export default function TrendingPlaces({ onSelectPlace }) {
  const { trending, loading } = useTrendingPlaces({ limit: 8, days: 30 })

  // Hide the section entirely when empty — no orphaned header
  if (!loading && trending.length === 0) {
    return null
  }

  return (
    <motion.section
      className="trending-places"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      aria-labelledby="trending-heading"
    >
      <div className="trending-header">
        <TrendingIcon />
        <h3 id="trending-heading" className="trending-heading">Popular this month</h3>
      </div>

      <div className="trending-row" role="list">
        {(loading ? Array.from({ length: 4 }) : trending).map((item, index) => {
          if (!item) {
            return (
              <div key={`skeleton-${index}`} className="trending-card trending-card--skeleton" role="listitem">
                <div className="trending-card-image trending-card-skeleton-shimmer" />
                <div className="trending-card-body">
                  <div className="trending-card-skeleton-line" />
                  <div className="trending-card-skeleton-line trending-card-skeleton-line--short" />
                </div>
              </div>
            )
          }
          const activity = formatActivity(item)
          return (
            <motion.div
              key={item.placeId}
              role="listitem"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.04, 0.4) }}
            >
              <Link
                to={`/place/${item.placeId}`}
                className="trending-card"
                onClick={(e) => {
                  // Allow parent to intercept (open detail modal) instead of
                  // a full navigation when handler is provided
                  if (onSelectPlace) {
                    e.preventDefault()
                    onSelectPlace(item.placeId)
                  }
                }}
              >
                <div className="trending-card-image">
                  <PlaceImage
                    place={{ id: item.placeId, ...(item.placeData || {}), name: item.placeName }}
                    alt={item.placeName || 'Place'}
                  />
                  {item.placeCategory && (
                    <span className="trending-card-category-pill">
                      {item.placeCategory}
                    </span>
                  )}
                </div>
                <div className="trending-card-body">
                  <span className="trending-card-name">{item.placeName || 'Unnamed place'}</span>
                  {activity && <span className="trending-card-activity">{activity}</span>}
                  {item.topTip && (
                    <span className="trending-card-tip">
                      &ldquo;{item.topTip.content.slice(0, 70)}{item.topTip.content.length > 70 ? '…' : ''}&rdquo;
                    </span>
                  )}
                </div>
              </Link>
            </motion.div>
          )
        })}
      </div>
    </motion.section>
  )
}

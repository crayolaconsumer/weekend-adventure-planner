/**
 * TrendingPlaces Component
 *
 * Shows places trending in the community based on recent activity
 */

import { motion } from 'framer-motion'
import { useTrendingPlaces } from '../hooks/useTrendingPlaces'
import './TrendingPlaces.css'

const TrendingIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </svg>
)

const FireIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 23c-4.97 0-9-3.58-9-8 0-2.1.8-4.01 2.12-5.46.65-.72 1.58-.54 2.06.18.38.57.62 1.28.62 2.03 0 .75-.38 1.43-1 1.83-.4.26-.71.64-.9 1.08-.19.44-.28.93-.26 1.42.1 2.04 1.79 3.67 3.86 3.92 2.07.25 3.94-.95 4.5-2.87.29-.98.3-2.02.02-3-.52-1.83-1.89-3.35-3.68-4.08-1.39-.57-2.34-1.9-2.34-3.41 0-1.02.42-1.95 1.1-2.62l.45-.45c.36-.36.85-.56 1.36-.56.51 0 1 .2 1.36.56.93.93 1.54 2.09 1.75 3.36.12.72.62 1.32 1.3 1.56.69.24 1.44.12 2-.32 1.62-1.28 2.62-3.23 2.62-5.41 0-.43-.04-.86-.11-1.27-.16-.91.34-1.8 1.18-2.12.29-.11.61-.14.92-.08 1.28.26 2.31 1.26 2.59 2.54.14.62.21 1.27.21 1.93 0 6.08-4.93 11-11 11z"/>
  </svg>
)

export default function TrendingPlaces({ onSelectPlace }) {
  const { trending, loading } = useTrendingPlaces({ limit: 5, days: 7 })

  // Don't render anything if no trending data
  if (!loading && trending.length === 0) {
    return null
  }

  if (loading) {
    return (
      <div className="trending-places trending-loading">
        <div className="trending-header">
          <TrendingIcon />
          <span>Trending</span>
        </div>
        <div className="trending-skeleton">
          {[1, 2, 3].map(i => (
            <div key={i} className="trending-skeleton-item" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <motion.div
      className="trending-places"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="trending-header">
        <TrendingIcon />
        <span>Trending This Week</span>
      </div>

      <div className="trending-list">
        {trending.map((item, index) => (
          <motion.button
            key={item.placeId}
            className="trending-item"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            onClick={() => onSelectPlace?.(item.placeId)}
          >
            <span className="trending-rank">#{index + 1}</span>
            <div className="trending-content">
              <div className="trending-place-name">{item.placeName || 'Unknown Place'}</div>
              {item.placeCategory && (
                <div className="trending-place-category">{item.placeCategory}</div>
              )}
              {item.topTip && (
                <div className="trending-tip">
                  "{item.topTip.content.slice(0, 60)}{item.topTip.content.length > 60 ? '...' : ''}"
                  <span className="trending-tip-author">— @{item.topTip.username}</span>
                </div>
              )}
            </div>
            <div className="trending-stats">
              <FireIcon />
              <span>{item.popularityScore}</span>
            </div>
          </motion.button>
        ))}
      </div>
    </motion.div>
  )
}

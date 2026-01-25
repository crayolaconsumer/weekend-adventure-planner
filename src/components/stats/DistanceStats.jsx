import { motion } from 'framer-motion'
import { calculateStatsSummary } from '../../utils/statsUtils'
import { useFormatDistance } from '../../contexts/DistanceContext'
import './stats.css'

const MapPinIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
)

const RouteIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="19" r="3"/>
    <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/>
    <circle cx="18" cy="5" r="3"/>
  </svg>
)

const TrophyIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
    <path d="M4 22h16"/>
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
  </svg>
)

const AvgIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/>
    <line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
)

export default function DistanceStats({ places }) {
  const stats = calculateStatsSummary(places)
  const formatDistance = useFormatDistance()

  const hasData = stats.totalDistanceKm > 0

  if (!hasData) {
    return (
      <div className="stats-card distance-stats empty">
        <h3 className="stats-card-title">Distance Explored</h3>
        <p className="stats-empty">Start visiting places to track your adventures</p>
      </div>
    )
  }

  return (
    <motion.div
      className="stats-card distance-stats"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h3 className="stats-card-title">Distance Explored</h3>

      <div className="distance-stats-grid">
        <motion.div
          className="distance-stat-item primary"
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.1 }}
        >
          <div className="distance-stat-icon">
            <RouteIcon />
          </div>
          <div className="distance-stat-content">
            <span className="distance-stat-value">
              {formatDistance(stats.totalDistanceKm)}
            </span>
            <span className="distance-stat-label">Total Distance</span>
          </div>
        </motion.div>

        <motion.div
          className="distance-stat-item"
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2 }}
        >
          <div className="distance-stat-icon">
            <TrophyIcon />
          </div>
          <div className="distance-stat-content">
            <span className="distance-stat-value">
              {formatDistance(stats.longestTripKm)}
            </span>
            <span className="distance-stat-label">Longest Trip</span>
          </div>
        </motion.div>

        <motion.div
          className="distance-stat-item"
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.3 }}
        >
          <div className="distance-stat-icon">
            <AvgIcon />
          </div>
          <div className="distance-stat-content">
            <span className="distance-stat-value">
              {formatDistance(stats.averageDistanceKm)}
            </span>
            <span className="distance-stat-label">Average Trip</span>
          </div>
        </motion.div>

        <motion.div
          className="distance-stat-item"
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.4 }}
        >
          <div className="distance-stat-icon">
            <MapPinIcon />
          </div>
          <div className="distance-stat-content">
            <span className="distance-stat-value">{stats.totalPlaces}</span>
            <span className="distance-stat-label">Places Visited</span>
          </div>
        </motion.div>
      </div>
    </motion.div>
  )
}

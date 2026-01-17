import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { GOOD_CATEGORIES } from '../../utils/categories'
import './stats.css'

export default function CategoryChart({ places }) {
  const chartData = useMemo(() => {
    if (!places || places.length === 0) return null

    // Count by category
    const counts = {}
    for (const place of places) {
      const cat = place.category || 'unknown'
      counts[cat] = (counts[cat] || 0) + 1
    }

    // Convert to array with colors and percentages
    const total = places.length
    const entries = Object.entries(counts)
      .map(([key, count]) => {
        const category = GOOD_CATEGORIES[key]
        return {
          key,
          label: category?.label || key,
          icon: category?.icon || '📍',
          color: category?.color || '#888',
          count,
          percent: Math.round((count / total) * 100)
        }
      })
      .sort((a, b) => b.count - a.count)

    // Build conic gradient stops
    let currentAngle = 0
    const gradientStops = entries.map(entry => {
      const start = currentAngle
      currentAngle += (entry.count / total) * 360
      return `${entry.color} ${start}deg ${currentAngle}deg`
    })

    return {
      entries,
      total,
      gradient: `conic-gradient(${gradientStops.join(', ')})`
    }
  }, [places])

  if (!chartData) {
    return (
      <div className="stats-card category-chart empty">
        <h3 className="stats-card-title">Categories</h3>
        <p className="stats-empty">Visit places to see your category breakdown</p>
      </div>
    )
  }

  return (
    <motion.div
      className="stats-card category-chart"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h3 className="stats-card-title">Categories</h3>

      <div className="category-chart-content">
        <div className="donut-container">
          <div
            className="donut-chart"
            style={{ background: chartData.gradient }}
          >
            <div className="donut-hole">
              <span className="donut-total">{chartData.total}</span>
              <span className="donut-label">places</span>
            </div>
          </div>
        </div>

        <div className="category-legend">
          {chartData.entries.slice(0, 5).map((entry, index) => (
            <motion.div
              key={entry.key}
              className="legend-item"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <span className="legend-color" style={{ backgroundColor: entry.color }} />
              <span className="legend-icon">{entry.icon}</span>
              <span className="legend-label">{entry.label}</span>
              <span className="legend-count">{entry.count}</span>
            </motion.div>
          ))}
          {chartData.entries.length > 5 && (
            <div className="legend-item more">
              <span className="legend-label">+{chartData.entries.length - 5} more</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

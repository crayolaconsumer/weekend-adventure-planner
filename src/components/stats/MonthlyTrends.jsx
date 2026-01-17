import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { aggregateByMonth } from '../../utils/statsUtils'
import './stats.css'

export default function MonthlyTrends({ places }) {
  const monthlyData = useMemo(() => {
    return aggregateByMonth(places, 6)
  }, [places])

  const maxCount = Math.max(...monthlyData.map(m => m.count), 1)
  const totalVisits = monthlyData.reduce((sum, m) => sum + m.count, 0)

  if (totalVisits === 0) {
    return (
      <div className="stats-card monthly-trends empty">
        <h3 className="stats-card-title">Monthly Activity</h3>
        <p className="stats-empty">Your activity history will appear here</p>
      </div>
    )
  }

  return (
    <motion.div
      className="stats-card monthly-trends"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h3 className="stats-card-title">Monthly Activity</h3>

      <div className="monthly-chart">
        <div className="monthly-bars">
          {monthlyData.map((month, index) => {
            const heightPercent = (month.count / maxCount) * 100

            return (
              <div key={month.key} className="monthly-bar-container">
                <motion.div
                  className="monthly-bar"
                  initial={{ height: 0 }}
                  animate={{ height: `${heightPercent}%` }}
                  transition={{ delay: index * 0.1, duration: 0.4, ease: 'easeOut' }}
                >
                  {month.count > 0 && (
                    <span className="monthly-bar-count">{month.count}</span>
                  )}
                </motion.div>
                <span className="monthly-bar-label">{month.label}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="monthly-summary">
        <span className="monthly-total">
          {totalVisits} {totalVisits === 1 ? 'place' : 'places'} in the last 6 months
        </span>
      </div>
    </motion.div>
  )
}

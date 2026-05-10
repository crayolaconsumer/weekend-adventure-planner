/**
 * StreakIndicator Component
 *
 * Displays current adventure streak with encouraging messages.
 * Designed to motivate without manipulation - celebrates action,
 * doesn't punish breaks.
 */

import { motion } from 'framer-motion'
import { useMemo } from 'react'
import './StreakIndicator.css'

/**
 * Get encouraging message based on streak count
 * Messages feel like encouragement from a friend, not a pushy app
 */
function getStreakMessage(streak) {
  if (streak === 0) {
    return { emoji: null, text: 'Ready for your first adventure?' }
  }
  if (streak === 1) {
    return { text: '1 day · Great start!' }
  }
  if (streak <= 3) {
    return { text: `${streak} days · You're on a roll!` }
  }
  if (streak <= 6) {
    return { text: `${streak} days · Building momentum!` }
  }
  if (streak <= 13) {
    return { text: `${streak} days · Unstoppable!` }
  }
  if (streak <= 29) {
    return { text: `${streak} days · True explorer!` }
  }
  // 30+ days
  return { text: `${streak} days · Intrepid adventurer!` }
}

/**
 * Brand flame — replaces the 🔥 emoji. Two-tone: gold outer flame
 * with a terracotta ember inside. Sized for inline-with-text use in
 * the streak chip. Same scout-merit visual language as PremiumBadge
 * + AchievementBadge.
 */
const FlameIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    {/* Outer flame body — gold */}
    <path
      d="M12 3.4 c-0.8 2.6 -4.4 4.2 -4.4 8.6 c0 4.4 3.5 8.4 8 8.4 c4.5 0 7.4 -3.4 7.4 -7.6 c0 -2 -0.7 -3.7 -2 -5.4 c-0.6 1.4 -1.8 2.2 -3.2 2.2 c0 -2.6 -1.8 -4.2 -5.8 -6.2 z"
      fill="#d4a855"
    />
    {/* Inner ember — terracotta */}
    <path
      d="M12 11.5 c-0.6 1.2 -2.2 2.4 -2.2 4.4 c0 1.9 1.5 3.4 3.4 3.4 c1.9 0 3.4 -1.5 3.4 -3.4 c0 -1.4 -1 -2.6 -2.4 -3.2 c-0.6 -0.4 -1.4 -0.7 -2.2 -1.2 z"
      fill="#c45c3e"
    />
    {/* Cream highlight pip — gives the flame depth at small sizes */}
    <circle cx="13.4" cy="16" r="0.9" fill="#fdfcf8" opacity="0.7" />
  </svg>
)

export default function StreakIndicator({ streak = 0 }) {
  const { text } = useMemo(() => getStreakMessage(streak), [streak])

  // Check if streak is active (has fire)
  const isActive = streak > 0

  return (
    <motion.div
      className={`streak-indicator ${isActive ? 'streak-active' : 'streak-ready'}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay: 0.3,
        ease: [0.25, 0.46, 0.45, 0.94]
      }}
    >
      {isActive && (
        <motion.span
          className="streak-emoji"
          animate={{ scale: [1, 1.15, 1] }}
          transition={{
            duration: 2,
            repeat: Infinity,
            repeatDelay: 4,
            ease: "easeInOut"
          }}
        >
          <FlameIcon />
        </motion.span>
      )}
      <span className="streak-text">{text}</span>
    </motion.div>
  )
}

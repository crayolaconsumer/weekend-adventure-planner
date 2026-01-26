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
    return { emoji: '✨', text: 'Ready for your first adventure?' }
  }
  if (streak === 1) {
    return { emoji: '🔥', text: '1 day · Great start!' }
  }
  if (streak <= 3) {
    return { emoji: '🔥', text: `${streak} days · You're on a roll!` }
  }
  if (streak <= 6) {
    return { emoji: '🔥', text: `${streak} days · Building momentum!` }
  }
  if (streak <= 13) {
    return { emoji: '🔥', text: `${streak} days · Unstoppable!` }
  }
  if (streak <= 29) {
    return { emoji: '🔥', text: `${streak} days · True explorer!` }
  }
  // 30+ days
  return { emoji: '🔥', text: `${streak} days · Intrepid adventurer!` }
}

export default function StreakIndicator({ streak = 0 }) {
  const { emoji, text } = useMemo(() => getStreakMessage(streak), [streak])

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
      <motion.span
        className="streak-emoji"
        animate={isActive ? {
          scale: [1, 1.15, 1],
        } : {}}
        transition={{
          duration: 2,
          repeat: Infinity,
          repeatDelay: 4,
          ease: "easeInOut"
        }}
      >
        {emoji}
      </motion.span>
      <span className="streak-text">{text}</span>
    </motion.div>
  )
}

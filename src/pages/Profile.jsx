import { useState } from 'react'
import { motion } from 'framer-motion'
import { getVisitedPlaces } from '../utils/statsUtils'
import CategoryChart from '../components/stats/CategoryChart'
import DistanceStats from '../components/stats/DistanceStats'
import MonthlyTrends from '../components/stats/MonthlyTrends'
import VisitedMap from '../components/stats/VisitedMap'
import './Profile.css'

// Badge definitions
const BADGES = [
  { id: 'first_adventure', name: 'First Steps', icon: '🌱', description: 'Completed your first adventure', requirement: (s) => s.timesWentOut >= 1 },
  { id: 'explorer_5', name: 'Explorer', icon: '🧭', description: 'Visited 5 places', requirement: (s) => s.timesWentOut >= 5 },
  { id: 'explorer_25', name: 'Pathfinder', icon: '🗺️', description: 'Visited 25 places', requirement: (s) => s.timesWentOut >= 25 },
  { id: 'explorer_100', name: 'Wanderer', icon: '🌍', description: 'Visited 100 places', requirement: (s) => s.timesWentOut >= 100 },
  { id: 'streak_3', name: 'Getting Into It', icon: '🔥', description: '3 day streak', requirement: (s) => s.bestStreak >= 3 },
  { id: 'streak_7', name: 'Week Warrior', icon: '⚡', description: '7 day streak', requirement: (s) => s.bestStreak >= 7 },
  { id: 'streak_30', name: 'Unstoppable', icon: '💪', description: '30 day streak', requirement: (s) => s.bestStreak >= 30 },
  { id: 'boredom_buster', name: 'Spontaneous', icon: '🎲', description: 'Used Boredom Buster 10 times', requirement: (s) => s.boredomBusts >= 10 },
  { id: 'curator', name: 'Curator', icon: '📚', description: 'Saved 20 places to wishlist', requirement: (s) => s.wishlistCount >= 20 },
  { id: 'planner', name: 'Planner', icon: '📋', description: 'Created 5 adventures', requirement: (s) => s.adventuresCreated >= 5 },
]

// Helper to load stats from localStorage (used for lazy initialization)
function loadStatsFromStorage() {
  const savedStats = JSON.parse(localStorage.getItem('roam_stats') || '{}')
  const wishlist = JSON.parse(localStorage.getItem('roam_wishlist') || '[]')
  const adventures = JSON.parse(localStorage.getItem('roam_adventures') || '[]')

  // Calculate streak
  const lastActivity = savedStats.lastActivityDate
  let currentStreak = savedStats.currentStreak || 0

  if (lastActivity) {
    const lastDate = new Date(lastActivity)
    const daysDiff = Math.floor((new Date() - lastDate) / (1000 * 60 * 60 * 24))

    if (daysDiff > 1) {
      currentStreak = 0 // Streak broken
    }
  }

  return {
    totalSwipes: 0,
    timesWentOut: 0,
    boredomBusts: 0,
    bestStreak: 0,
    lastActivityDate: null,
    ...savedStats,
    currentStreak,
    wishlistCount: wishlist.length,
    adventuresCreated: adventures.length
  }
}

export default function Profile() {
  // Use lazy initialization to load stats from localStorage
  const [stats] = useState(loadStatsFromStorage)
  const [visitedPlaces] = useState(getVisitedPlaces)

  // Get earned badges
  const earnedBadges = BADGES.filter(badge => badge.requirement(stats))
  const lockedBadges = BADGES.filter(badge => !badge.requirement(stats))

  // Calculate level based on total activity
  const totalActivity = (stats.timesWentOut || 0) + (stats.boredomBusts || 0) + (stats.adventuresCreated || 0)
  const level = Math.floor(Math.sqrt(totalActivity)) + 1
  const nextLevelRequirement = Math.pow(level, 2)
  const levelProgress = ((totalActivity - Math.pow(level - 1, 2)) / (nextLevelRequirement - Math.pow(level - 1, 2))) * 100

  return (
    <div className="page profile-page">
      <header className="page-header">
        <h1 className="page-title">Your Journey</h1>
      </header>

      <div className="page-content">
        {/* Level Card */}
        <motion.div
          className="profile-level-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="profile-level-header">
            <div className="profile-level-badge">
              <span className="profile-level-number">{level}</span>
            </div>
            <div className="profile-level-info">
              <h2 className="profile-level-title">Level {level} Explorer</h2>
              <p className="profile-level-subtitle">
                {nextLevelRequirement - totalActivity} more activities to level up
              </p>
            </div>
          </div>

          <div className="profile-level-progress">
            <div
              className="profile-level-progress-bar"
              style={{ width: `${Math.min(100, levelProgress)}%` }}
            />
          </div>
        </motion.div>

        {/* Visual Stats Dashboard */}
        <div className="profile-viz-grid">
          <VisitedMap places={visitedPlaces} />
          <CategoryChart places={visitedPlaces} />
        </div>

        <div className="profile-stats-extended">
          <DistanceStats places={visitedPlaces} />
          <MonthlyTrends places={visitedPlaces} />
        </div>

        {/* Stats Grid */}
        <div className="profile-stats">
          <div className="stat-card">
            <span className="stat-value">{stats.timesWentOut || 0}</span>
            <span className="stat-label">Places Visited</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.currentStreak || 0}</span>
            <span className="stat-label">Day Streak</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.boredomBusts || 0}</span>
            <span className="stat-label">Boredom Busts</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.wishlistCount || 0}</span>
            <span className="stat-label">Saved Places</span>
          </div>
        </div>

        {/* Badges */}
        <div className="profile-section">
          <h3 className="profile-section-title">Badges</h3>

          {earnedBadges.length > 0 && (
            <div className="profile-badges earned">
              {earnedBadges.map((badge, index) => (
                <motion.div
                  key={badge.id}
                  className="profile-badge"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <span className="profile-badge-icon">{badge.icon}</span>
                  <span className="profile-badge-name">{badge.name}</span>
                  <span className="profile-badge-desc">{badge.description}</span>
                </motion.div>
              ))}
            </div>
          )}

          {lockedBadges.length > 0 && (
            <>
              <h4 className="profile-subsection-title">Locked</h4>
              <div className="profile-badges locked">
                {lockedBadges.map(badge => (
                  <div key={badge.id} className="profile-badge locked">
                    <span className="profile-badge-icon">🔒</span>
                    <span className="profile-badge-name">{badge.name}</span>
                    <span className="profile-badge-desc">{badge.description}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Best Streak */}
        {stats.bestStreak > 0 && (
          <div className="profile-highlight">
            <span className="profile-highlight-icon">🏆</span>
            <div className="profile-highlight-content">
              <span className="profile-highlight-value">{stats.bestStreak} days</span>
              <span className="profile-highlight-label">Best Streak</span>
            </div>
          </div>
        )}

        {/* Motivational Message */}
        <div className="profile-motivation">
          {stats.currentStreak === 0 && stats.timesWentOut === 0 && (
            <p>Time to start your adventure! Hit "I'm Bored" to discover somewhere new.</p>
          )}
          {stats.currentStreak === 0 && stats.timesWentOut > 0 && (
            <p>Your streak has reset. Get out there today to start a new one!</p>
          )}
          {stats.currentStreak >= 1 && stats.currentStreak < 7 && (
            <p>You're on a {stats.currentStreak} day streak! Keep it going!</p>
          )}
          {stats.currentStreak >= 7 && (
            <p>Incredible! A whole week of adventures. You're unstoppable!</p>
          )}
        </div>
      </div>
    </div>
  )
}

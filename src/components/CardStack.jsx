import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import SwipeCard from './SwipeCard'
import './CardStack.css'

// Rotating loading messages for variety
const LOADING_MESSAGES = [
  { title: 'Discovering places', subtitle: 'Finding hidden gems near you...' },
  { title: 'Scanning the map', subtitle: 'Looking for adventures...' },
  { title: 'Exploring nearby', subtitle: 'Uncovering local treasures...' },
  { title: 'Almost there', subtitle: 'Curating the best spots...' },
]

// Compass icon component
const CompassIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88" fill="currentColor" stroke="none" />
  </svg>
)

// Refresh icon
const RefreshIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 2v6h-6"/>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
    <path d="M3 22v-6h6"/>
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
  </svg>
)

// Settings icon
const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="21" x2="4" y2="14"/>
    <line x1="4" y1="10" x2="4" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="12"/>
    <line x1="12" y1="8" x2="12" y2="3"/>
    <line x1="20" y1="21" x2="20" y2="16"/>
    <line x1="20" y1="12" x2="20" y2="3"/>
  </svg>
)

export default function CardStack({
  places,
  onSwipe,
  onExpand,
  onEmpty,
  onRefresh,
  onOpenSettings,
  loading = false,
  emptyReason = 'swiped' // 'swiped' | 'no-places' | 'error'
}) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0)

  // Reset index when places change - legitimate pattern for syncing state to props
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setCurrentIndex(0)
  }, [places])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Rotate loading messages
  useEffect(() => {
    if (!loading) return
    const interval = setInterval(() => {
      setLoadingMessageIndex(prev => (prev + 1) % LOADING_MESSAGES.length)
    }, 2500)
    return () => clearInterval(interval)
  }, [loading])

  const handleSwipe = (action) => {
    const place = places[currentIndex]

    // Notify parent
    onSwipe?.(action, place)

    // Open directions for "go" action
    if (action === 'go' && place) {
      const url = `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`
      window.open(url, '_blank')
    }

    // Move to next card
    setTimeout(() => {
      setCurrentIndex(prev => {
        const next = prev + 1
        if (next >= places.length) {
          onEmpty?.()
        }
        return next
      })
    }, 100)
  }

  // Get visible cards (current + 2 behind)
  const visibleCards = places.slice(currentIndex, currentIndex + 3)

  const currentMessage = LOADING_MESSAGES[loadingMessageIndex]

  if (loading) {
    return (
      <div className="card-stack">
        <div className="card-stack-loading">
          <motion.div
            className="card-stack-loading-icon"
            animate={{ rotate: [0, 45, -30, 15, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <CompassIcon />
          </motion.div>
          <div className="card-stack-loading-cards">
            <motion.div
              className="loading-card"
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="loading-card"
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
            />
            <motion.div
              className="loading-card"
              animate={{ y: [0, -2, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
            />
          </div>
          <div className="card-stack-loading-text">
            <AnimatePresence mode="wait">
              <motion.div
                key={loadingMessageIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
              >
                <h4>{currentMessage.title}</h4>
                <p>{currentMessage.subtitle}</p>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    )
  }

  // Determine empty state type
  const isSwipedThrough = places.length > 0 && currentIndex >= places.length
  const hasNoPlaces = places.length === 0

  if (hasNoPlaces || isSwipedThrough) {
    const emptyConfig = isSwipedThrough ? {
      icon: '🎉',
      title: 'All caught up!',
      subtitle: "You've explored all nearby adventures. Refresh to discover more or expand your travel radius.",
      primaryAction: onRefresh ? { label: 'Discover More', icon: <RefreshIcon />, action: onRefresh } : null,
      secondaryAction: onOpenSettings ? { label: 'Adjust Settings', icon: <SettingsIcon />, action: onOpenSettings } : null
    } : emptyReason === 'error' ? {
      icon: '😕',
      title: 'Something went wrong',
      subtitle: "We couldn't load places right now. Check your connection and try again.",
      primaryAction: onRefresh ? { label: 'Try Again', icon: <RefreshIcon />, action: onRefresh } : null,
      secondaryAction: null
    } : {
      icon: '🗺️',
      title: 'No places nearby',
      subtitle: "We couldn't find adventures in this area. Try increasing your travel radius or exploring a different location.",
      primaryAction: onOpenSettings ? { label: 'Expand Radius', icon: <SettingsIcon />, action: onOpenSettings } : null,
      secondaryAction: onRefresh ? { label: 'Refresh', icon: <RefreshIcon />, action: onRefresh } : null
    }

    return (
      <div className="card-stack">
        <motion.div
          className="card-stack-empty"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <motion.div
            className="card-stack-empty-illustration"
            style={{ fontSize: 72 }}
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            {emptyConfig.icon}
          </motion.div>
          <h3>{emptyConfig.title}</h3>
          <p>{emptyConfig.subtitle}</p>
          <div className="card-stack-empty-action">
            {emptyConfig.primaryAction && (
              <motion.button
                className="card-stack-empty-btn"
                onClick={emptyConfig.primaryAction.action}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {emptyConfig.primaryAction.icon}
                {emptyConfig.primaryAction.label}
              </motion.button>
            )}
            {emptyConfig.secondaryAction && (
              <motion.button
                className="card-stack-empty-btn secondary"
                onClick={emptyConfig.secondaryAction.action}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {emptyConfig.secondaryAction.icon}
                {emptyConfig.secondaryAction.label}
              </motion.button>
            )}
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="card-stack">
      <div className="card-stack-wrapper">
        <AnimatePresence>
          {visibleCards.map((place, index) => {
            const isTop = index === 0
            const scale = 1 - (index * 0.04)
            const yOffset = index * 8

            return (
              <motion.div
                key={place.id}
                className="card-stack-item"
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{
                  scale,
                  y: yOffset,
                  opacity: 1,
                  zIndex: visibleCards.length - index
                }}
                exit={{
                  opacity: 0,
                  transition: { duration: 0.2 }
                }}
                transition={{
                  type: 'spring',
                  stiffness: 300,
                  damping: 30
                }}
                style={{
                  position: 'absolute',
                  width: '100%'
                }}
              >
                <SwipeCard
                  place={place}
                  onSwipe={isTop ? handleSwipe : undefined}
                  onExpand={isTop ? onExpand : undefined}
                  isTop={isTop}
                />
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {/* Progress indicator */}
      <div className="card-stack-progress">
        <div className="card-stack-progress-bar">
          <motion.div
            className="card-stack-progress-fill"
            initial={{ width: 0 }}
            animate={{ width: `${((currentIndex + 1) / places.length) * 100}%` }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        </div>
        <span className="card-stack-count">
          {currentIndex + 1} of {places.length}
        </span>
      </div>
    </div>
  )
}

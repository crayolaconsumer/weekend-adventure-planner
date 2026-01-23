/**
 * PlanPrompt - Post-save celebration prompt
 *
 * A delightful modal that appears after saving a place to wishlist,
 * encouraging users to add it to their adventure plan.
 *
 * Features warm, organic animations with floating particles
 * and a celebratory checkmark.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import './PlanPrompt.css'

// Bookmark/map icon - represents saved adventures
const BookmarkMapIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    <circle cx="12" cy="10" r="2" fill="currentColor" stroke="none" />
  </svg>
)

// Checkmark for success badge
const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

// Compass icon for the button
const CompassIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor" stroke="none" />
  </svg>
)

export default function PlanPrompt({ place, onClose, onAddToPlan }) {
  const navigate = useNavigate()

  if (!place) return null

  const handleAddToPlan = () => {
    // Store the place to be added to the plan
    const pendingPlanPlace = localStorage.getItem('roam_pending_plan_place')
    const pending = pendingPlanPlace ? JSON.parse(pendingPlanPlace) : []

    // Add if not already there
    if (!pending.some(p => p.id === place.id)) {
      pending.push({
        ...place,
        addedAt: Date.now()
      })
      localStorage.setItem('roam_pending_plan_place', JSON.stringify(pending))
    }

    onAddToPlan?.()
    navigate('/plan')
  }

  const handleDismiss = () => {
    onClose?.()
  }

  return (
    <AnimatePresence>
      <motion.div
        className="plan-prompt-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleDismiss}
      >
        <motion.div
          className="plan-prompt"
          initial={{ opacity: 0, y: 60, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 30, scale: 0.95 }}
          transition={{
            type: 'spring',
            stiffness: 350,
            damping: 28,
            mass: 0.8
          }}
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="plan-prompt-title"
        >
          {/* Floating celebration particles */}
          <div className="plan-prompt-particles">
            <span className="plan-prompt-particle" />
            <span className="plan-prompt-particle" />
            <span className="plan-prompt-particle" />
            <span className="plan-prompt-particle" />
            <span className="plan-prompt-particle" />
          </div>

          <button
            className="plan-prompt-close"
            onClick={handleDismiss}
            aria-label="Dismiss"
          >
            <CloseIcon />
          </button>

          {/* Animated icon with tilted background */}
          <motion.div
            className="plan-prompt-icon"
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{
              type: 'spring',
              stiffness: 400,
              damping: 15,
              delay: 0.1
            }}
          >
            <div className="plan-prompt-icon-bg" />
            <div className="plan-prompt-icon-inner">
              <BookmarkMapIcon />
            </div>
            {/* Success checkmark badge */}
            <motion.div
              className="plan-prompt-check"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{
                type: 'spring',
                stiffness: 500,
                damping: 15,
                delay: 0.3
              }}
            >
              <CheckIcon />
            </motion.div>
          </motion.div>

          <motion.div
            className="plan-prompt-content"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h3 id="plan-prompt-title" className="plan-prompt-title">
              Saved to wishlist!
            </h3>
            <p className="plan-prompt-text">
              Add <strong>{place.name}</strong> to an adventure?
            </p>
          </motion.div>

          <motion.div
            className="plan-prompt-actions"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <button
              className="plan-prompt-btn primary"
              onClick={handleAddToPlan}
            >
              <span className="plan-prompt-btn-icon">
                <CompassIcon />
              </span>
              Plan Adventure
            </button>
            <button
              className="plan-prompt-btn ghost"
              onClick={handleDismiss}
            >
              Maybe Later
            </button>
          </motion.div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

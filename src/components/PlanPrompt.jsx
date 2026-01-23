/**
 * PlanPrompt - Post-save prompt for adding places to plans
 *
 * Shows a compact prompt after saving a place, encouraging users
 * to add it to their adventure plan.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import './PlanPrompt.css'

const MapIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="1,6 1,22 8,18 16,22 23,18 23,2 16,6 8,2"/>
    <line x1="8" y1="2" x2="8" y2="18"/>
    <line x1="16" y1="6" x2="16" y2="22"/>
  </svg>
)

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
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
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="plan-prompt-title"
        >
          <button
            className="plan-prompt-close"
            onClick={handleDismiss}
            aria-label="Dismiss"
          >
            <CloseIcon />
          </button>

          <div className="plan-prompt-icon">
            <MapIcon />
          </div>

          <div className="plan-prompt-content">
            <h3 id="plan-prompt-title" className="plan-prompt-title">
              Saved to wishlist!
            </h3>
            <p className="plan-prompt-text">
              Add <strong>{place.name}</strong> to an adventure?
            </p>
          </div>

          <div className="plan-prompt-actions">
            <button
              className="plan-prompt-btn primary"
              onClick={handleAddToPlan}
            >
              Plan Adventure
            </button>
            <button
              className="plan-prompt-btn ghost"
              onClick={handleDismiss}
            >
              Maybe Later
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

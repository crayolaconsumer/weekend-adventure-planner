/**
 * PlanVisitSheet Component
 *
 * Bottom sheet for scheduling a visit to a place.
 * Creates an "implementation intention" - research shows
 * specifying when increases follow-through by 91%.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFocusTrap } from '../hooks/useFocusTrap'
import './PlanVisitSheet.css'

// Icons
const CalendarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
)

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const CheckIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

/**
 * Get formatted date options relative to today
 */
function getDateOptions() {
  const today = new Date()
  const dayOfWeek = today.getDay() // 0 = Sunday

  // Tomorrow
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  // This weekend (Saturday)
  const thisWeekend = new Date(today)
  const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7
  thisWeekend.setDate(thisWeekend.getDate() + daysUntilSaturday)

  // Next weekend (Saturday after this one)
  const nextWeekend = new Date(thisWeekend)
  nextWeekend.setDate(nextWeekend.getDate() + 7)

  return [
    {
      id: 'tomorrow',
      label: 'Tomorrow',
      sublabel: formatDateShort(tomorrow),
      date: tomorrow
    },
    {
      id: 'this-weekend',
      label: dayOfWeek === 6 ? 'Today' : dayOfWeek === 0 ? 'Next Saturday' : 'This Weekend',
      sublabel: formatDateShort(thisWeekend),
      date: thisWeekend
    },
    {
      id: 'next-weekend',
      label: 'Next Weekend',
      sublabel: formatDateShort(nextWeekend),
      date: nextWeekend
    }
  ]
}

function formatDateShort(date) {
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  })
}

function formatDateFriendly(date) {
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (date.toDateString() === today.toDateString()) {
    return 'today'
  }
  if (date.toDateString() === tomorrow.toDateString()) {
    return 'tomorrow morning'
  }

  const dayName = date.toLocaleDateString('en-GB', { weekday: 'long' })
  return `${dayName} morning`
}

export default function PlanVisitSheet({
  isOpen,
  onClose,
  place,
  onPlanVisit
}) {
  const [selectedDate, setSelectedDate] = useState(null)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [customDate, setCustomDate] = useState('')
  const [showCustomPicker, setShowCustomPicker] = useState(false)
  const focusTrapRef = useFocusTrap(isOpen)

  const dateOptions = getDateOptions()

  // Reset state when sheet opens
  useEffect(() => {
    if (isOpen) {
      setSelectedDate(null)
      setShowConfirmation(false)
      setShowCustomPicker(false)
      setCustomDate('')
    }
  }, [isOpen])

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  // Prevent body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isOpen])

  const handleSelectDate = (option) => {
    setSelectedDate(option.date)
    setShowConfirmation(true)

    // Trigger the callback
    onPlanVisit?.(place, option.date)

    // Auto-close after showing confirmation
    setTimeout(() => {
      onClose()
    }, 2000)
  }

  const handleCustomDate = () => {
    if (!customDate) return

    const date = new Date(customDate)
    setSelectedDate(date)
    setShowConfirmation(true)

    onPlanVisit?.(place, date)

    setTimeout(() => {
      onClose()
    }, 2000)
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        className="plan-visit-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          ref={focusTrapRef}
          className="plan-visit-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="plan-visit-title"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          onClick={e => e.stopPropagation()}
        >
          {!showConfirmation ? (
            <>
              {/* Header */}
              <div className="plan-visit-header">
                <div className="plan-visit-header-content">
                  <CalendarIcon />
                  <h2 id="plan-visit-title">When do you want to go?</h2>
                </div>
                <button
                  className="plan-visit-close"
                  onClick={onClose}
                  aria-label="Close"
                >
                  <CloseIcon />
                </button>
              </div>

              {/* Place info */}
              <div className="plan-visit-place">
                <span className="plan-visit-place-name">{place?.name}</span>
              </div>

              {/* Date options */}
              <div className="plan-visit-options">
                {dateOptions.map((option, index) => (
                  <motion.button
                    key={option.id}
                    className="plan-visit-option"
                    onClick={() => handleSelectDate(option)}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <span className="plan-visit-option-label">{option.label}</span>
                    <span className="plan-visit-option-date">{option.sublabel}</span>
                  </motion.button>
                ))}

                {/* Custom date option */}
                {!showCustomPicker ? (
                  <motion.button
                    className="plan-visit-option plan-visit-option-custom"
                    onClick={() => setShowCustomPicker(true)}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                  >
                    <span className="plan-visit-option-label">Pick a date...</span>
                  </motion.button>
                ) : (
                  <motion.div
                    className="plan-visit-custom-picker"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                  >
                    <input
                      type="date"
                      className="plan-visit-date-input"
                      value={customDate}
                      onChange={(e) => setCustomDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                    />
                    <button
                      className="plan-visit-confirm-date"
                      onClick={handleCustomDate}
                      disabled={!customDate}
                    >
                      Confirm
                    </button>
                  </motion.div>
                )}
              </div>

              {/* Subtle motivation */}
              <p className="plan-visit-hint">
                We'll send you a reminder so you don't forget
              </p>
            </>
          ) : (
            /* Confirmation */
            <motion.div
              className="plan-visit-confirmation"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <motion.div
                className="plan-visit-confirmation-icon"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.1 }}
              >
                <CheckIcon />
              </motion.div>
              <h3>Perfect!</h3>
              <p>
                We'll remind you {selectedDate ? formatDateFriendly(selectedDate) : 'soon'}
              </p>
            </motion.div>
          )}

          {/* Drag handle */}
          <div className="plan-visit-handle" aria-hidden="true" />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

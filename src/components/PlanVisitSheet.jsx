/**
 * PlanVisitSheet Component
 *
 * Bottom sheet for scheduling a visit to a place.
 * Creates an "implementation intention" - research shows
 * specifying when increases follow-through by 91%.
 */

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useLockBodyScroll } from '../hooks/useLockBodyScroll'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { useAuth } from '../contexts/AuthContext'
import { openAppSettings } from '../utils/nativePlugins'
import { useBottomSheetDismiss } from '../hooks/useBottomSheetDismiss'
import { tap as hapticTap, success as hapticSuccess } from '../utils/haptics'
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
  // Disable swipe-dismiss during confirmation (the 2-second
  // success state auto-dismisses on its own).
  const dismissDrag = useBottomSheetDismiss(onClose, { enabled: !showConfirmation })

  // Push permission ask — gated behind sign-in. Anonymous users can save
  // the planned date locally but their device-to-user mapping doesn't
  // exist on the server, so no reminder would ever fire. Asking them
  // for OS permission anyway would be a false promise. For anonymous
  // users we surface a "Sign in to get a reminder" CTA instead.
  const { subscribe: subscribePush, permission: pushPermission, supported: pushSupported } = usePushNotifications()
  const { isAuthenticated } = useAuth()

  // Use ref pattern to avoid stale closure issues with onPlanVisit callback
  const onPlanVisitRef = useRef(onPlanVisit)
  useEffect(() => {
    onPlanVisitRef.current = onPlanVisit
  }, [onPlanVisit])

  const maybeAskForPushPermission = () => {
    if (!isAuthenticated) return
    if (!pushSupported) return
    if (pushPermission === 'granted' || pushPermission === 'denied') return
    subscribePush().catch(() => {})
  }

  const openSignInModal = () => {
    // Match the global pattern used by ContributionPrompt etc.
    window.dispatchEvent(new CustomEvent('openAuthModal', { detail: { mode: 'register' } }))
    onClose()
  }

  const dateOptions = getDateOptions()

  // Reset form state when sheet opens. React-recommended pattern:
  // compare prev-vs-current during render so the reset is a single
  // batched render instead of an effect-pass-render-pass cycle.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen)
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen)
    if (isOpen) {
      setSelectedDate(null)
      setShowConfirmation(false)
      setShowCustomPicker(false)
      setCustomDate('')
    }
  }

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
  useLockBodyScroll(isOpen)

  const handleSelectDate = (option) => {
    setSelectedDate(option.date)
    setShowConfirmation(true)
    hapticSuccess()

    // Trigger the callback (using ref to avoid stale closure)
    onPlanVisitRef.current?.(place, option.date)

    // Ask for push permission now — the user just committed to a date
    // and we just promised a reminder. Best contextual moment.
    maybeAskForPushPermission()

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
    hapticSuccess()

    onPlanVisitRef.current?.(place, date)
    maybeAskForPushPermission()

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
          {...dismissDrag}
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
                    onClick={() => { hapticTap('light'); setShowCustomPicker(true) }}
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

              {/* Honest reminder promise. Signed-in users get an actual
                  push on the day; anonymous users don't, so don't claim
                  we will. */}
              <p className="plan-visit-hint">
                {isAuthenticated
                  ? "We'll send you a reminder so you don't forget"
                  : "Sign in to get a reminder on the day"}
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
              {/* Three confirmation states based on what we can
                  actually deliver:
                  - Anonymous: plan is local-only; offer sign-in.
                  - Signed in + permission granted (or 'default' — the
                    OS dialog just fired): promise the reminder.
                  - Signed in + permission denied: we can't undo their
                    earlier "no" without an OS-level toggle, so surface
                    a deep link to the device settings. */}
              {!isAuthenticated ? (
                <>
                  <p>
                    Plan saved {selectedDate ? formatDateFriendly(selectedDate) : ''}.
                  </p>
                  <button
                    type="button"
                    className="plan-visit-signin-cta"
                    onClick={openSignInModal}
                  >
                    Sign in to get a reminder →
                  </button>
                </>
              ) : pushSupported && pushPermission === 'denied' ? (
                <>
                  <p>
                    Plan saved {selectedDate ? formatDateFriendly(selectedDate) : ''}.
                  </p>
                  <button
                    type="button"
                    className="plan-visit-signin-cta"
                    onClick={() => { openAppSettings() }}
                  >
                    Turn on notifications to get a reminder →
                  </button>
                </>
              ) : (
                <p>
                  We'll remind you {selectedDate ? formatDateFriendly(selectedDate) : 'soon'}
                </p>
              )}
            </motion.div>
          )}

          {/* Drag handle */}
          <div className="plan-visit-handle" aria-hidden="true" />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

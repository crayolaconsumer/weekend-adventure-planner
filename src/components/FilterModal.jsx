/**
 * FilterModal Component
 *
 * Premium category filter experience for mobile.
 * Replaces horizontal scroll with an engaging bottom sheet.
 *
 * Psychological principles applied:
 * - Immediate visual feedback (selection animations)
 * - Clear hierarchy (grid shows all options)
 * - Satisfying micro-interactions (bounce, glow)
 * - Progress indication (active count badge)
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { motion, AnimatePresence, useDragControls } from 'framer-motion'
import { GOOD_CATEGORIES } from '../utils/categories'
import './FilterModal.css'

// Backdrop animation
const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 }
}

// Sheet slides up from bottom
const sheetVariants = {
  hidden: { y: '100%' },
  visible: {
    y: 0,
    transition: {
      type: 'spring',
      damping: 30,
      stiffness: 300,
      mass: 0.8
    }
  },
  exit: {
    y: '100%',
    transition: {
      type: 'spring',
      damping: 35,
      stiffness: 400
    }
  }
}

// Staggered category items
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.1
    }
  }
}

const itemVariants = {
  hidden: { opacity: 0, scale: 0.8, y: 20 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: 'spring',
      damping: 20,
      stiffness: 300
    }
  }
}

export function FilterModal({
  isOpen,
  onClose,
  travelMode,
  travelModes,
  onTravelModeChange,
  selectedCategories = [],
  onToggleCategory,
  showFreeOnly = false,
  onToggleFreeOnly = () => {},
  accessibilityMode = false,
  onToggleAccessibility = () => {},
  showOpenOnly = false,
  onToggleOpenOnly = () => {},
  onClearAll = null,
  isPremium = false,
  onShowUpgrade = () => {}
}) {
  const sheetRef = useRef(null)
  const firstFocusableRef = useRef(null)
  const dragControls = useDragControls()
  const [isExpanded, setIsExpanded] = useState(false)

  // Reset expanded state when modal opens - intentional state sync
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional reset on modal open
      setIsExpanded(false)
    }
  }, [isOpen])

  // Focus trap
  useEffect(() => {
    if (isOpen && firstFocusableRef.current) {
      firstFocusableRef.current.focus()
    }
  }, [isOpen])

  // Handle escape key
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }, [onClose])

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)

      // Prevent body scroll without layout shift
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
      document.body.style.overflow = 'hidden'
      document.body.style.paddingRight = `${scrollbarWidth}px`

      // Prevent iOS bounce/rubber-band effect
      document.body.style.position = 'fixed'
      document.body.style.top = `-${window.scrollY}px`
      document.body.style.width = '100%'

      return () => {
        document.removeEventListener('keydown', handleKeyDown)

        // Restore scroll position
        const scrollY = document.body.style.top
        document.body.style.overflow = ''
        document.body.style.paddingRight = ''
        document.body.style.position = ''
        document.body.style.top = ''
        document.body.style.width = ''
        window.scrollTo(0, parseInt(scrollY || '0') * -1)
      }
    }
  }, [isOpen, handleKeyDown])

  // Prevent scroll on backdrop
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  const activeCount = selectedCategories.length + (showFreeOnly ? 1 : 0) + (accessibilityMode ? 1 : 0) + (showOpenOnly ? 1 : 0)
  const categories = Object.entries(GOOD_CATEGORIES)

  const handleDragStart = (event) => {
    dragControls.start(event)
  }

  const handleDragEnd = (_, info) => {
    const offsetY = info.offset.y
    const expandThreshold = 80
    const closeThreshold = 160

    if (offsetY < -expandThreshold) {
      setIsExpanded(true)
      return
    }

    if (offsetY > closeThreshold) {
      onClose()
      return
    }

    if (isExpanded && offsetY > expandThreshold) {
      setIsExpanded(false)
    }
  }

  const handleClearAll = () => {
    if (onClearAll) {
      onClearAll()
      return
    }

    // Fallback: toggle everything off
    selectedCategories.forEach(cat => onToggleCategory(cat))
    if (showFreeOnly) onToggleFreeOnly()
    if (accessibilityMode) onToggleAccessibility()
    if (showOpenOnly) onToggleOpenOnly()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="filter-modal-backdrop"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          onClick={handleBackdropClick}
          role="dialog"
          aria-modal="true"
          aria-label="Filter categories"
        >
          <motion.div
            ref={sheetRef}
            className={`filter-modal-sheet ${isExpanded ? 'expanded' : ''}`}
            variants={sheetVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: -120, bottom: 200 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
          >
            {/* Handle bar */}
            <div
              className="filter-modal-handle"
              role="button"
              tabIndex={0}
              aria-label="Drag to resize"
              onPointerDown={handleDragStart}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setIsExpanded(prev => !prev)
                }
              }}
            />

            {/* Header */}
            <div className="filter-modal-header">
              <div className="filter-modal-title-row">
                <h2 className="filter-modal-title">What interests you?</h2>
                {activeCount > 0 && (
                  <motion.span
                    className="filter-modal-count"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    key={activeCount}
                  >
                    {activeCount}
                  </motion.span>
                )}
              </div>
              <p className="filter-modal-subtitle">Select categories to explore</p>
            </div>

            <div className="filter-modal-body">
              {travelModes && onTravelModeChange && (
                <div className="filter-modal-section">
                  <div className="filter-modal-section-header">
                    <span className="filter-modal-section-title">Travel mode</span>
                  </div>
                  <div className="filter-modal-mode-grid">
                    {Object.entries(travelModes).map(([key, mode]) => (
                      <button
                        key={key}
                        className={`filter-modal-mode-item ${travelMode === key ? 'active' : ''}`}
                        onClick={() => onTravelModeChange(key)}
                      >
                        <span className="filter-modal-mode-icon">{mode.icon}</span>
                        <span className="filter-modal-mode-label">{mode.label}</span>
                        <span className="filter-modal-mode-detail">
                          Up to {mode.maxRadius / 1000}km
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {travelModes && onTravelModeChange && (
                <div className="filter-modal-divider" aria-hidden="true" />
              )}

              {/* Category Grid */}
              <motion.div
                className="filter-modal-grid"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
              >
                {categories.map(([key, category]) => {
                  const isSelected = selectedCategories.includes(key)
                  return (
                    <motion.button
                      key={key}
                      variants={itemVariants}
                      className={`filter-category-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => onToggleCategory(key)}
                      aria-pressed={isSelected}
                      whileTap={{ scale: 0.92 }}
                      style={{
                        '--category-color': category.color,
                        '--category-color-glow': `${category.color}40`,
                      }}
                      ref={key === 'food' ? firstFocusableRef : null}
                    >
                      <span className="filter-category-icon" aria-hidden="true">
                        {category.icon}
                      </span>
                      <span className="filter-category-label">{category.label}</span>

                      {/* Selection indicator */}
                      <AnimatePresence>
                        {isSelected && (
                          <motion.span
                            className="filter-category-check"
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0, opacity: 0 }}
                            transition={{ type: 'spring', damping: 15, stiffness: 400 }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </motion.button>
                  )
                })}
              </motion.div>

              {/* Additional Filters */}
              <div className="filter-modal-extras">
                <button
                  className={`filter-extra-item ${showFreeOnly ? 'selected' : ''}`}
                  onClick={onToggleFreeOnly}
                  aria-pressed={showFreeOnly}
                >
                  <span className="filter-extra-icon" aria-hidden="true">💸</span>
                  <span className="filter-extra-label">Free only</span>
                  <span className={`filter-extra-toggle ${showFreeOnly ? 'on' : ''}`}>
                    <span className="filter-extra-toggle-knob" />
                  </span>
                </button>

                <button
                  className={`filter-extra-item ${accessibilityMode ? 'selected' : ''}`}
                  onClick={onToggleAccessibility}
                  aria-pressed={accessibilityMode}
                >
                  <span className="filter-extra-icon" aria-hidden="true">♿</span>
                  <span className="filter-extra-label">Accessible places</span>
                  <span className={`filter-extra-toggle ${accessibilityMode ? 'on' : ''}`}>
                    <span className="filter-extra-toggle-knob" />
                  </span>
                </button>

                <button
                  className={`filter-extra-item ${showOpenOnly ? 'selected' : ''}`}
                  onClick={onToggleOpenOnly}
                  aria-pressed={showOpenOnly}
                >
                  <span className="filter-extra-icon" aria-hidden="true">🕐</span>
                  <span className="filter-extra-label">Open now</span>
                  <span className={`filter-extra-toggle ${showOpenOnly ? 'on' : ''}`}>
                    <span className="filter-extra-toggle-knob" />
                  </span>
                </button>
              </div>

              {/* Premium Filters */}
              <div className="filter-modal-premium">
                <div className="filter-premium-header">
                  <span className="filter-premium-sparkle">✨</span>
                  <span>Premium Filters</span>
                </div>
                <button
                  className={`filter-extra-item ${!isPremium ? 'locked' : ''}`}
                  onClick={() => isPremium ? null : onShowUpgrade()}
                  disabled={isPremium}
                >
                  <span className="filter-extra-icon" aria-hidden="true">📍</span>
                  <span className="filter-extra-label">Locals' picks</span>
                  {!isPremium && <span className="filter-premium-badge">ROAM+</span>}
                </button>
                <button
                  className={`filter-extra-item ${!isPremium ? 'locked' : ''}`}
                  onClick={() => isPremium ? null : onShowUpgrade()}
                  disabled={isPremium}
                >
                  <span className="filter-extra-icon" aria-hidden="true">⏰</span>
                  <span className="filter-extra-label">Off-peak times</span>
                  {!isPremium && <span className="filter-premium-badge">ROAM+</span>}
                </button>
              </div>
            </div>

            <span className="filter-modal-scroll-hint" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14" />
                <path d="M7 14l5 5 5-5" />
              </svg>
              Scroll for more
            </span>

            {/* Footer */}
            <div className="filter-modal-footer">
              <button
                className="filter-modal-clear"
                onClick={handleClearAll}
                disabled={activeCount === 0}
              >
                Clear all
              </button>
              <button
                className="filter-modal-apply"
                onClick={onClose}
              >
                Show places
                {activeCount > 0 && (
                  <span className="filter-modal-apply-badge">{activeCount} filter{activeCount !== 1 ? 's' : ''}</span>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default FilterModal

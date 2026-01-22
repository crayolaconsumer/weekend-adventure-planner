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

import { useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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
  selectedCategories = [],
  onToggleCategory,
  showFreeOnly,
  onToggleFreeOnly,
  accessibilityMode,
  onToggleAccessibility
}) {
  const sheetRef = useRef(null)
  const firstFocusableRef = useRef(null)

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
      document.body.style.overflow = 'hidden'
      return () => {
        document.removeEventListener('keydown', handleKeyDown)
        document.body.style.overflow = ''
      }
    }
  }, [isOpen, handleKeyDown])

  // Prevent scroll on backdrop
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  const activeCount = selectedCategories.length + (showFreeOnly ? 1 : 0) + (accessibilityMode ? 1 : 0)
  const categories = Object.entries(GOOD_CATEGORIES)

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
            className="filter-modal-sheet"
            variants={sheetVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Handle bar */}
            <div className="filter-modal-handle" />

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
            </div>

            {/* Footer */}
            <div className="filter-modal-footer">
              <button
                className="filter-modal-clear"
                onClick={() => {
                  // Clear all selections
                  selectedCategories.forEach(cat => onToggleCategory(cat))
                  if (showFreeOnly) onToggleFreeOnly()
                  if (accessibilityMode) onToggleAccessibility()
                }}
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

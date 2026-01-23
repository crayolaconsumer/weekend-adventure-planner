/**
 * SubscriptionSuccessModal
 *
 * Celebration modal shown when a user successfully subscribes to ROAM+.
 * Displays a list of unlocked features with satisfying animations.
 */

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import './SubscriptionSuccessModal.css'

// Brand colors for confetti
const BRAND_COLORS = ['#c45c3e', '#d4a855', '#1a3a2f', '#87a28e', '#e8c677']

// Pre-computed confetti particle positions (generated once at module load)
// This ensures pure render function while maintaining visual variety
const CONFETTI_PARTICLES = [
  { id: 0, x: -120, y: -95, rotate: 45 },
  { id: 1, x: 85, y: -130, rotate: 180 },
  { id: 2, x: -75, y: 110, rotate: 270 },
  { id: 3, x: 140, y: 65, rotate: 90 },
  { id: 4, x: -45, y: -140, rotate: 315 },
  { id: 5, x: 95, y: 85, rotate: 135 },
  { id: 6, x: -130, y: 40, rotate: 225 },
  { id: 7, x: 60, y: -80, rotate: 60 },
  { id: 8, x: -90, y: 125, rotate: 300 },
  { id: 9, x: 110, y: -50, rotate: 150 },
  { id: 10, x: -55, y: 75, rotate: 30 },
  { id: 11, x: 75, y: 100, rotate: 240 }
].map((p, i) => ({ ...p, color: BRAND_COLORS[i % BRAND_COLORS.length] }))

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 }
}

const modalVariants = {
  hidden: { scale: 0.8, opacity: 0, y: 20 },
  visible: {
    scale: 1,
    opacity: 1,
    y: 0,
    transition: {
      type: 'spring',
      damping: 25,
      stiffness: 300
    }
  },
  exit: {
    scale: 0.9,
    opacity: 0,
    y: 10,
    transition: { duration: 0.2 }
  }
}

const featureVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: (i) => ({
    opacity: 1,
    x: 0,
    transition: {
      delay: 0.3 + i * 0.1,
      type: 'spring',
      damping: 20
    }
  })
}

const FEATURES = [
  { icon: '✓', text: 'Unlimited saves & collections' },
  { icon: '✓', text: 'Ad-free exploring' },
  { icon: '✓', text: 'Premium filters' },
  { icon: '✓', text: 'Export adventures' }
]

export default function SubscriptionSuccessModal({ isOpen, onClose }) {
  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [isOpen])

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="success-modal-backdrop"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          onClick={onClose}
        >
          <motion.div
            className="success-modal"
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="success-modal-title"
          >
            {/* Celebration emoji */}
            <motion.div
              className="success-icon"
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{
                type: 'spring',
                damping: 12,
                stiffness: 200,
                delay: 0.1
              }}
            >
              🎉
            </motion.div>

            <h2 id="success-modal-title" className="success-title">
              Welcome to ROAM+!
            </h2>
            <p className="success-subtitle">
              You've unlocked unlimited adventures
            </p>

            <ul className="success-features">
              {FEATURES.map((feature, index) => (
                <motion.li
                  key={feature.text}
                  custom={index}
                  variants={featureVariants}
                  initial="hidden"
                  animate="visible"
                >
                  <span className="success-feature-check">{feature.icon}</span>
                  {feature.text}
                </motion.li>
              ))}
            </ul>

            <motion.button
              className="success-btn"
              onClick={onClose}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Start Exploring
            </motion.button>
          </motion.div>

          {/* Confetti particles */}
          <div className="success-confetti" aria-hidden="true">
            {CONFETTI_PARTICLES.map((particle) => (
              <motion.div
                key={particle.id}
                className="confetti-particle"
                initial={{
                  x: 0,
                  y: 0,
                  rotate: 0,
                  opacity: 1
                }}
                animate={{
                  x: particle.x,
                  y: particle.y,
                  rotate: particle.rotate,
                  opacity: 0
                }}
                transition={{
                  duration: 1.5,
                  delay: particle.id * 0.05,
                  ease: 'easeOut'
                }}
                style={{
                  backgroundColor: particle.color
                }}
              />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

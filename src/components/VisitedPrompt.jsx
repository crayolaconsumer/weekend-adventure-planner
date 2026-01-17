import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { saveVisitedPlace } from '../utils/statsUtils'
import { saveRating, VIBE_OPTIONS, NOISE_OPTIONS, VALUE_OPTIONS } from '../utils/ratingsStorage'
import './VisitedPrompt.css'

// Pre-generated confetti particles (random values computed once at module load)
const CONFETTI_COLORS = ['#1a3a2f', '#d4a855', '#7c9a82', '#f5f0e6', '#ef4444', '#3b82f6']
const CONFETTI_PARTICLES = Array.from({ length: 30 }, (_, i) => ({
  id: i,
  delay: i * 0.05,
  color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
  x: Math.random() * 200 - 100,
  rotation: Math.random() * 360
}))

// Confetti particle - receives pre-computed random values as props
const Confetti = ({ delay, color, x, rotation }) => (
  <motion.div
    className="confetti"
    style={{ backgroundColor: color }}
    initial={{ y: -20, x: 0, opacity: 1, rotate: 0 }}
    animate={{
      y: 300,
      x: x,
      opacity: 0,
      rotate: rotation,
    }}
    transition={{
      duration: 1.5,
      delay: delay,
      ease: 'easeOut',
    }}
  />
)

// Icons
const CheckIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

const XIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const ThumbsUpIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
  </svg>
)

const ThumbsDownIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>
  </svg>
)

export default function VisitedPrompt({ place, userLocation, onConfirm, onDismiss }) {
  // Steps: 'confirm' | 'recommend' | 'feedback' | 'review' | 'success'
  const [step, setStep] = useState('confirm')
  const [showConfetti, setShowConfetti] = useState(false)

  // Rating state
  const [recommended, setRecommended] = useState(null)
  const [selectedVibe, setSelectedVibe] = useState(null)
  const [selectedNoise, setSelectedNoise] = useState(null)
  const [selectedValue, setSelectedValue] = useState(null)
  const [reviewText, setReviewText] = useState('')

  const handleVisited = () => {
    setStep('recommend')
  }

  const handleRecommend = (isRecommended) => {
    setRecommended(isRecommended)
    setStep('feedback')
  }

  const handleFeedbackContinue = () => {
    setStep('review')
  }

  const handleFeedbackSkip = () => {
    finishRating()
  }

  const handleReviewSubmit = () => {
    finishRating()
  }

  const handleReviewSkip = () => {
    finishRating()
  }

  const finishRating = () => {
    // Save visited place with full data
    saveVisitedPlace(place, userLocation, recommended)

    // Save enhanced rating
    saveRating(place.id, {
      recommended: recommended === true,
      vibe: selectedVibe,
      noiseLevel: selectedNoise,
      valueForMoney: selectedValue,
      review: reviewText.trim() || null,
      visitedAt: Date.now(),
      categoryKey: place.category?.key || null
    })

    // Update stats
    const stats = JSON.parse(localStorage.getItem('roam_stats') || '{}')
    stats.placesVisited = (stats.placesVisited || 0) + 1
    if (recommended) {
      stats.placesLiked = (stats.placesLiked || 0) + 1
    }
    localStorage.setItem('roam_stats', JSON.stringify(stats))

    // Show celebration
    setStep('success')
    setShowConfetti(true)

    // Notify parent and auto-close
    onConfirm?.(place, recommended)
    setTimeout(() => {
      onDismiss?.()
    }, 2500)
  }

  const handleSkipRating = () => {
    // Save visited place with full data (location, distance, category)
    saveVisitedPlace(place, userLocation, null)

    // Still count as visited
    const stats = JSON.parse(localStorage.getItem('roam_stats') || '{}')
    stats.placesVisited = (stats.placesVisited || 0) + 1
    localStorage.setItem('roam_stats', JSON.stringify(stats))

    setStep('success')
    setShowConfetti(true)
    onConfirm?.(place, null)
    setTimeout(() => {
      onDismiss?.()
    }, 2500)
  }

  // Feedback chip toggle helper
  const toggleChip = (current, value, setter) => {
    setter(current === value ? null : value)
  }

  return (
    <AnimatePresence>
      <motion.div
        className="visited-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(e) => e.target === e.currentTarget && onDismiss?.()}
      >
        {/* Confetti */}
        {showConfetti && (
          <div className="confetti-container">
            {CONFETTI_PARTICLES.map((particle) => (
              <Confetti key={particle.id} {...particle} />
            ))}
          </div>
        )}

        <motion.div
          className="visited-modal"
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        >
          {/* Close button */}
          {step !== 'success' && (
            <button className="visited-close" onClick={onDismiss}>
              <XIcon />
            </button>
          )}

          <AnimatePresence mode="wait">
            {step === 'confirm' && (
              <motion.div
                key="confirm"
                className="visited-content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="visited-place-info">
                  <span className="visited-category">{place.category?.icon}</span>
                  <h3 className="visited-place-name">{place.name}</h3>
                </div>

                <p className="visited-question">Did you visit this place?</p>

                <div className="visited-actions">
                  <motion.button
                    className="visited-btn primary"
                    onClick={handleVisited}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <CheckIcon />
                    <span>Yes, I went!</span>
                  </motion.button>
                  <button className="visited-btn secondary" onClick={onDismiss}>
                    Not yet
                  </button>
                </div>
              </motion.div>
            )}

            {step === 'recommend' && (
              <motion.div
                key="recommend"
                className="visited-content"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <motion.div
                  className="visited-icon-success"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                >
                  🎉
                </motion.div>

                <h3 className="visited-title">Would you recommend it?</h3>
                <p className="visited-subtitle">Help fellow explorers find great places</p>

                <div className="visited-rating-btns">
                  <motion.button
                    className="rating-btn like"
                    onClick={() => handleRecommend(true)}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <ThumbsUpIcon />
                    <span>Yes!</span>
                  </motion.button>
                  <motion.button
                    className="rating-btn dislike"
                    onClick={() => handleRecommend(false)}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <ThumbsDownIcon />
                    <span>Not really</span>
                  </motion.button>
                </div>

                <button className="visited-skip" onClick={handleSkipRating}>
                  Skip rating
                </button>
              </motion.div>
            )}

            {step === 'feedback' && (
              <motion.div
                key="feedback"
                className="visited-content"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <h3 className="visited-title">Quick feedback</h3>
                <p className="visited-subtitle">Optional - tap any that apply</p>

                <div className="feedback-section">
                  <span className="feedback-label">Vibe</span>
                  <div className="feedback-chips">
                    {VIBE_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        className={`feedback-chip ${selectedVibe === opt.value ? 'selected' : ''}`}
                        onClick={() => toggleChip(selectedVibe, opt.value, setSelectedVibe)}
                      >
                        <span>{opt.icon}</span>
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="feedback-section">
                  <span className="feedback-label">Noise level</span>
                  <div className="feedback-chips">
                    {NOISE_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        className={`feedback-chip ${selectedNoise === opt.value ? 'selected' : ''}`}
                        onClick={() => toggleChip(selectedNoise, opt.value, setSelectedNoise)}
                      >
                        <span>{opt.icon}</span>
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="feedback-section">
                  <span className="feedback-label">Value</span>
                  <div className="feedback-chips">
                    {VALUE_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        className={`feedback-chip ${selectedValue === opt.value ? 'selected' : ''}`}
                        onClick={() => toggleChip(selectedValue, opt.value, setSelectedValue)}
                      >
                        <span>{opt.icon}</span>
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="feedback-actions">
                  <motion.button
                    className="visited-btn primary"
                    onClick={handleFeedbackContinue}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    Add a review
                  </motion.button>
                  <button className="visited-skip" onClick={handleFeedbackSkip}>
                    Done
                  </button>
                </div>
              </motion.div>
            )}

            {step === 'review' && (
              <motion.div
                key="review"
                className="visited-content"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <h3 className="visited-title">Share your thoughts</h3>
                <p className="visited-subtitle">Optional - what made it memorable?</p>

                <div className="review-input-wrapper">
                  <textarea
                    className="review-textarea"
                    placeholder="E.g., Great atmosphere, loved the outdoor seating..."
                    value={reviewText}
                    onChange={(e) => setReviewText(e.target.value.slice(0, 500))}
                    maxLength={500}
                    rows={4}
                  />
                  <span className="review-char-count">{reviewText.length}/500</span>
                </div>

                <div className="feedback-actions">
                  <motion.button
                    className="visited-btn primary"
                    onClick={handleReviewSubmit}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    Submit
                  </motion.button>
                  <button className="visited-skip" onClick={handleReviewSkip}>
                    Skip
                  </button>
                </div>
              </motion.div>
            )}

            {step === 'success' && (
              <motion.div
                key="success"
                className="visited-content success"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  className="visited-icon-celebration"
                  animate={{ rotate: [0, 10, -10, 0] }}
                  transition={{ duration: 0.5, repeat: 2 }}
                >
                  🏆
                </motion.div>
                <h3 className="visited-title">Adventure Complete!</h3>
                <p className="visited-subtitle">Keep exploring to unlock badges</p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

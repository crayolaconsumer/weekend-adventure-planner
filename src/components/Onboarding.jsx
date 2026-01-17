import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { GOOD_CATEGORIES } from '../utils/categories'
import './Onboarding.css'

const SLIDES = [
  {
    icon: '🗺️',
    title: 'Welcome to ROAM',
    subtitle: 'Your guide to local adventures',
    description: 'Discover hidden gems, fight boredom, and explore your city like never before.'
  },
  {
    icon: '👆',
    title: 'Swipe to Explore',
    subtitle: "It's simple",
    description: "Swipe right to save places, left to skip, or up when you're ready to go now!",
    showGestures: true
  },
  {
    icon: '🎲',
    title: 'Feeling Bored?',
    subtitle: 'Let us surprise you',
    description: "Tap \"I'm Bored\" and we'll pick the perfect adventure based on your location, weather, and time of day."
  }
]

// Arrow icon
const ArrowIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12"/>
    <polyline points="12 5 19 12 12 19"/>
  </svg>
)

// Check icon
const CheckIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

// Location icon
const LocationIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21,10c0,7-9,13-9,13S3,17,3,10a9,9,0,0,1,18,0Z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
)

export default function Onboarding({ onComplete }) {
  const [currentSlide, setCurrentSlide] = useState(0)
  const [selectedInterests, setSelectedInterests] = useState([])
  const [showInterests, setShowInterests] = useState(false)
  const [locationRequested, setLocationRequested] = useState(false)

  const isLastSlide = currentSlide === SLIDES.length - 1

  const handleNext = () => {
    if (isLastSlide) {
      setShowInterests(true)
    } else {
      setCurrentSlide(prev => prev + 1)
    }
  }

  const handleBack = () => {
    if (showInterests) {
      setShowInterests(false)
    } else if (currentSlide > 0) {
      setCurrentSlide(prev => prev - 1)
    }
  }

  const toggleInterest = (key) => {
    setSelectedInterests(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )
  }

  const handleComplete = () => {
    // Save preferences
    if (selectedInterests.length > 0) {
      localStorage.setItem('roam_interests', JSON.stringify(selectedInterests))
    }
    localStorage.setItem('roam_onboarded', 'true')
    onComplete()
  }

  const requestLocation = () => {
    setLocationRequested(true)
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        () => {
          // Success - location will be handled by App.jsx
        },
        () => {
          // Error - that's okay, we'll use fallback
        },
        { enableHighAccuracy: true, timeout: 10000 }
      )
    }
  }

  const slide = SLIDES[currentSlide]

  return (
    <motion.div
      className="onboarding-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="onboarding-container">
        {/* Progress dots */}
        <div className="onboarding-progress">
          {SLIDES.map((_, i) => (
            <div
              key={i}
              className={`onboarding-dot ${i === currentSlide ? 'active' : ''} ${i < currentSlide ? 'completed' : ''}`}
            />
          ))}
          <div className={`onboarding-dot ${showInterests ? 'active' : ''}`} />
        </div>

        <AnimatePresence mode="wait">
          {!showInterests ? (
            <motion.div
              key={currentSlide}
              className="onboarding-slide"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.3 }}
            >
              <motion.div
                className="onboarding-icon"
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                {slide.icon}
              </motion.div>

              <h1 className="onboarding-title">{slide.title}</h1>
              <p className="onboarding-subtitle">{slide.subtitle}</p>
              <p className="onboarding-description">{slide.description}</p>

              {/* Gesture hints for swipe slide */}
              {slide.showGestures && (
                <div className="onboarding-gestures">
                  <div className="gesture-hint">
                    <span className="gesture-arrow left">←</span>
                    <span>Skip</span>
                  </div>
                  <div className="gesture-hint">
                    <span className="gesture-arrow up">↑</span>
                    <span>Go Now</span>
                  </div>
                  <div className="gesture-hint">
                    <span className="gesture-arrow right">→</span>
                    <span>Save</span>
                  </div>
                </div>
              )}

              {/* Location request on first slide */}
              {currentSlide === 0 && !locationRequested && (
                <motion.button
                  className="onboarding-location-btn"
                  onClick={requestLocation}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <LocationIcon />
                  <span>Enable Location</span>
                </motion.button>
              )}

              {currentSlide === 0 && locationRequested && (
                <div className="onboarding-location-success">
                  <CheckIcon />
                  <span>Location enabled</span>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="interests"
              className="onboarding-slide"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.3 }}
            >
              <motion.div
                className="onboarding-icon"
                animate={{ rotate: [0, 10, -10, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                ✨
              </motion.div>

              <h1 className="onboarding-title">What excites you?</h1>
              <p className="onboarding-subtitle">Pick a few to personalize your experience</p>

              <div className="onboarding-interests">
                {Object.entries(GOOD_CATEGORIES).map(([key, category]) => (
                  <motion.button
                    key={key}
                    className={`interest-chip ${selectedInterests.includes(key) ? 'selected' : ''}`}
                    onClick={() => toggleInterest(key)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    style={{
                      '--chip-color': category.color,
                    }}
                  >
                    <span className="interest-icon">{category.icon}</span>
                    <span>{category.label}</span>
                    {selectedInterests.includes(key) && (
                      <motion.span
                        className="interest-check"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                      >
                        <CheckIcon />
                      </motion.span>
                    )}
                  </motion.button>
                ))}
              </div>

              <p className="onboarding-skip-hint">
                You can always change this later
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation */}
        <div className="onboarding-nav">
          {(currentSlide > 0 || showInterests) && (
            <button className="onboarding-back" onClick={handleBack}>
              Back
            </button>
          )}

          {!showInterests ? (
            <motion.button
              className="onboarding-next"
              onClick={handleNext}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <span>{isLastSlide ? 'Almost done' : 'Next'}</span>
              <ArrowIcon />
            </motion.button>
          ) : (
            <motion.button
              className="onboarding-complete"
              onClick={handleComplete}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <span>Start Exploring</span>
              <ArrowIcon />
            </motion.button>
          )}
        </div>

        {/* Skip option */}
        {!showInterests && (
          <button className="onboarding-skip" onClick={handleComplete}>
            Skip intro
          </button>
        )}
      </div>
    </motion.div>
  )
}

import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { GOOD_CATEGORIES } from '../utils/categories'
import { useAuth } from '../contexts/AuthContext'
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

// Google icon
const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
)

export default function Onboarding({ onComplete }) {
  const { loginWithGoogle } = useAuth()
  const [currentSlide, setCurrentSlide] = useState(0)
  const [selectedInterests, setSelectedInterests] = useState([])
  const [showInterests, setShowInterests] = useState(false)
  const [showSignIn, setShowSignIn] = useState(false)
  const [locationRequested, setLocationRequested] = useState(false)
  const [signInLoading, setSignInLoading] = useState(false)
  const [signInError, setSignInError] = useState(null)

  const isLastSlide = currentSlide === SLIDES.length - 1

  const handleNext = () => {
    if (isLastSlide) {
      setShowInterests(true)
    } else {
      setCurrentSlide(prev => prev + 1)
    }
  }

  const handleBack = () => {
    if (showSignIn) {
      setShowSignIn(false)
    } else if (showInterests) {
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

  const savePreferencesAndComplete = useCallback(() => {
    // Save preferences
    if (selectedInterests.length > 0) {
      localStorage.setItem('roam_interests', JSON.stringify(selectedInterests))
    }
    localStorage.setItem('roam_onboarded', 'true')
    onComplete()
  }, [selectedInterests, onComplete])

  const handleInterestsDone = () => {
    // Move to sign-in step
    setShowSignIn(true)
  }

  const handleComplete = () => {
    savePreferencesAndComplete()
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

  // Google Sign-In handler
  const handleGoogleSignIn = useCallback(async () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId) {
      setSignInError('Google Sign-In is not configured')
      return
    }
    if (!window.google?.accounts) {
      setSignInError('Google Sign-In is loading, please try again')
      return
    }

    setSignInError(null)

    if (window.google.accounts.oauth2) {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'email profile',
        callback: async (response) => {
          if (response.error) {
            setSignInError(response.error_description || 'Google sign-in failed')
            return
          }
          try {
            setSignInLoading(true)
            const userInfo = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${response.access_token}` }
            }).then(r => r.json())

            const result = await loginWithGoogle({
              accessToken: response.access_token,
              userInfo
            })

            setSignInLoading(false)
            if (result.success) {
              savePreferencesAndComplete()
            } else {
              setSignInError(result.error)
            }
          } catch {
            setSignInLoading(false)
            setSignInError('Failed to sign in with Google')
          }
        }
      })
      tokenClient.requestAccessToken()
    }
  }, [loginWithGoogle, savePreferencesAndComplete])

  // Load Google Sign-In script
  useEffect(() => {
    if (!showSignIn) return

    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId) return

    if (!window.google && !document.getElementById('google-signin-script')) {
      const script = document.createElement('script')
      script.id = 'google-signin-script'
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
  }, [showSignIn])

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
              className={`onboarding-dot ${i === currentSlide && !showInterests && !showSignIn ? 'active' : ''} ${i < currentSlide || showInterests || showSignIn ? 'completed' : ''}`}
            />
          ))}
          <div className={`onboarding-dot ${showInterests && !showSignIn ? 'active' : ''} ${showSignIn ? 'completed' : ''}`} />
          <div className={`onboarding-dot ${showSignIn ? 'active' : ''}`} />
        </div>

        <AnimatePresence mode="wait">
          {!showInterests && !showSignIn ? (
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
          ) : showInterests && !showSignIn ? (
            <motion.div
              key="interests"
              className="onboarding-slide"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.3 }}
            >
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
          ) : (
            <motion.div
              key="signin"
              className="onboarding-slide"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.3 }}
            >
              <h1 className="onboarding-title">Save your discoveries</h1>
              <p className="onboarding-subtitle">Create an account to sync across devices</p>
              <p className="onboarding-description">
                Your saved places will be backed up and available on any device.
              </p>

              <div className="onboarding-signin-options">
                <motion.button
                  className="onboarding-google-btn"
                  onClick={handleGoogleSignIn}
                  disabled={signInLoading}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {signInLoading ? (
                    <span className="onboarding-loading-spinner" />
                  ) : (
                    <>
                      <GoogleIcon />
                      <span>Continue with Google</span>
                    </>
                  )}
                </motion.button>

                {signInError && (
                  <p className="onboarding-signin-error">{signInError}</p>
                )}
              </div>

              <p className="onboarding-skip-hint">
                You can also sign in later from your profile
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation */}
        <div className="onboarding-nav">
          {(currentSlide > 0 || showInterests || showSignIn) && (
            <button className="onboarding-back" onClick={handleBack}>
              Back
            </button>
          )}

          {!showInterests && !showSignIn ? (
            <motion.button
              className="onboarding-next"
              onClick={handleNext}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <span>{isLastSlide ? 'Almost done' : 'Next'}</span>
              <ArrowIcon />
            </motion.button>
          ) : showInterests && !showSignIn ? (
            <motion.button
              className="onboarding-next"
              onClick={handleInterestsDone}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <span>Continue</span>
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
        {!showInterests && !showSignIn && (
          <button className="onboarding-skip" onClick={handleComplete}>
            Skip intro
          </button>
        )}
      </div>
    </motion.div>
  )
}

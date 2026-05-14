/**
 * Onboarding
 *
 * Compressed single-screen welcome — replaces the previous 5-screen
 * flow (welcome / swipe tutorial / Just Go pitch / interest grid /
 * sign-in). Native-app convention: let users feel the value FIRST,
 * defer commitment.
 *
 * What we deferred to contextual moments later:
 *   - Interest selection → re-surface as a 'Personalize your feed'
 *     nudge once they've done a few swipes
 *   - Sign-in → AuthModal is the canonical surface; we offer a small
 *     'Already have an account? Sign in' link here for returning users
 *   - Swipe gesture tutorial → in-card affordance pulse on first card
 *     (the thumbs buttons make swipe optional anyway)
 *
 * App.jsx handles the actual location-permission prompt right after
 * onComplete fires, so this component doesn't need its own location
 * step.
 */

import { useCallback } from 'react'
import { motion } from 'framer-motion'
import './Onboarding.css'

const ArrowIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12"/>
    <polyline points="12 5 19 12 12 19"/>
  </svg>
)

const CompassMark = () => (
  /* The brand favicon, inlined for a hero centerpiece — no extra request */
  <svg width="120" height="120" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="256" cy="256" r="256" fill="#1a3a2f"/>
    <g transform="translate(256, 256)">
      <circle cx="0" cy="0" r="180" fill="none" stroke="#d4a855" strokeWidth="8"/>
      <polygon points="0,-160 20,-40 -20,-40" fill="#d4a855"/>
      <polygon points="0,160 20,40 -20,40" fill="#fdfcf8"/>
      <polygon points="160,0 40,20 40,-20" fill="#fdfcf8"/>
      <polygon points="-160,0 -40,20 -40,-20" fill="#fdfcf8"/>
      <circle cx="0" cy="0" r="30" fill="#d4a855"/>
      <circle cx="0" cy="0" r="15" fill="#1a3a2f"/>
    </g>
  </svg>
)

export default function Onboarding({ onComplete }) {
  // Push permission isn't asked here — it'd be a false promise. An
  // anonymous user can grant the OS-level dialog but their device
  // token can't be associated to a user-id on the server, so no
  // pushes would actually reach them. The prompt fires automatically
  // the moment they sign in (see PushAuthSync in App.jsx) and again
  // contextually in PlanVisitSheet for signed-in users without it.

  const handleStart = useCallback(() => {
    localStorage.setItem('roam_onboarded', 'true')
    onComplete()
  }, [onComplete])

  const handleSignIn = useCallback(() => {
    localStorage.setItem('roam_onboarded', 'true')
    onComplete()
    // App.jsx listens for this event and opens AuthModal — same path
    // the rest of the app uses for sign-in
    window.dispatchEvent(new CustomEvent('openAuthModal', { detail: { mode: 'login' } }))
  }, [onComplete])

  return (
    <motion.div
      className="onboarding-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="onboarding-container">
        <motion.div
          className="onboarding-slide"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          {/* Hero compass — brand identity in a single mark */}
          <motion.div
            className="onboarding-hero-mark"
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.15, type: 'spring', stiffness: 220, damping: 18 }}
          >
            <CompassMark />
          </motion.div>

          <h1 className="onboarding-title">ROAM</h1>
          <p className="onboarding-subtitle">Local adventures, hand-picked for you</p>
          <p className="onboarding-description">
            Hidden gems, quiet corners, weekend plans — without the endless scroll.
          </p>

          <div className="onboarding-actions">
            <motion.button
              className="onboarding-cta"
              onClick={handleStart}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <span>Get started</span>
              <ArrowIcon />
            </motion.button>

            <button
              className="onboarding-signin-link"
              onClick={handleSignIn}
              type="button"
            >
              Already have an account? <strong>Sign in</strong>
            </button>
          </div>
        </motion.div>
      </div>
    </motion.div>
  )
}

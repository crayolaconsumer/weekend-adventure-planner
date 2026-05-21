/**
 * Re-Sign-In Banner
 *
 * Soft nudge for users who've previously signed in but are currently
 * logged out — JWT expired (30-day idle), explicit logout that they
 * regret, or a password reset that hasn't been completed.
 *
 * Render rules:
 *   - User must NOT be currently authenticated
 *   - localStorage flag `roam_has_signed_in` must be 'true' (set in
 *     AuthContext on every successful login). First-time visitors
 *     who've never signed in DON'T see this — they're a different
 *     onboarding flow.
 *   - User must not have dismissed within the last 7 days
 *     (`roam_signin_nudge_dismissed_until` epoch ms)
 *
 * Behaviour:
 *   - Tapping the banner body opens the AuthModal (via onSignIn)
 *   - Tapping the × snoozes for 7 days
 *
 * The 7-day snooze is intentional. Daily nag would be hostile. Weekly
 * matches the natural cadence of "I'll get round to it next weekend"
 * thinking that this audience operates on anyway.
 */

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { tap as hapticTap } from '../utils/haptics'
import './ReSignInBanner.css'

const HAS_SIGNED_IN_KEY = 'roam_has_signed_in'
const DISMISSED_UNTIL_KEY = 'roam_signin_nudge_dismissed_until'
const SNOOZE_DURATION_MS = 7 * 24 * 60 * 60 * 1000

function readDismissedUntil() {
  try {
    const raw = localStorage.getItem(DISMISSED_UNTIL_KEY)
    if (!raw) return 0
    const n = parseInt(raw, 10)
    return Number.isFinite(n) ? n : 0
  } catch { return 0 }
}

function hasSignedInBefore() {
  try {
    return localStorage.getItem(HAS_SIGNED_IN_KEY) === 'true'
  } catch { return false }
}

export default function ReSignInBanner({ onSignIn }) {
  const { isAuthenticated, loading } = useAuth()
  const [dismissedUntil, setDismissedUntil] = useState(() => readDismissedUntil())

  // Re-read on visibility change so a user who dismissed on one tab
  // doesn't see the banner reappear when they switch back.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setDismissedUntil(readDismissedUntil())
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const handleDismiss = useCallback((e) => {
    e?.stopPropagation()
    hapticTap('light')
    const until = Date.now() + SNOOZE_DURATION_MS
    try { localStorage.setItem(DISMISSED_UNTIL_KEY, String(until)) } catch { /* private mode */ }
    setDismissedUntil(until)
  }, [])

  const handleSignIn = useCallback(() => {
    hapticTap('medium')
    onSignIn?.()
  }, [onSignIn])

  if (loading) return null
  if (isAuthenticated) return null
  if (!hasSignedInBefore()) return null
  // Wall-clock check against the snooze deadline. The render fn is
  // ostensibly impure here, but re-render frequency is low (only on
  // auth state changes or dismissal) so this is a cheap deterministic
  // gate, not a performance/correctness risk.
  // eslint-disable-next-line react-hooks/purity
  if (Date.now() < dismissedUntil) return null

  return (
    <AnimatePresence>
      <motion.div
        className="resignin-banner"
        role="region"
        aria-label="Sign back in to keep your saves and notifications"
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      >
        <button
          type="button"
          className="resignin-banner-body"
          onClick={handleSignIn}
        >
          <span className="resignin-banner-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
          </span>
          <span className="resignin-banner-text">
            <span className="resignin-banner-title">Welcome back</span>
            <span className="resignin-banner-sub">Sign in to keep your saves and get notifications.</span>
          </span>
          <span className="resignin-banner-cta">Sign in</span>
        </button>
        <button
          type="button"
          className="resignin-banner-dismiss"
          onClick={handleDismiss}
          aria-label="Dismiss for a week"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </motion.div>
    </AnimatePresence>
  )
}

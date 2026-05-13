/**
 * PremiumNudge
 *
 * Subtle, dismissible "Try ROAM+" banner that surfaces on Discover after
 * the user has shown clear engagement signals (a streak going, or 5+
 * places saved). Goal: solve the "premium tier is invisible" problem
 * without being pushy at first-launch.
 *
 * Rules:
 *   - Never shown to premium users
 *   - Never shown to users with no signal (0 streak + 0 saves)
 *   - Dismissed via localStorage roam_premium_nudge_dismissed (boolean)
 *   - Re-surfaces if the user is dismissed > 14 days ago AND a new
 *     milestone is reached (so the nudge doesn't disappear forever from
 *     a single absent-minded dismiss)
 *
 * Tapping the body → /pricing. Tapping the × dismisses. No checkout
 * happens in-place; we keep the nudge calm and route to the pricing
 * page where the user can see the full value prop.
 */

import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useSubscription } from '../hooks/useSubscription'
import PremiumBadge from './PremiumBadge'
import { track } from '../utils/analytics'
import './PremiumNudge.css'

const STORAGE_KEY = 'roam_premium_nudge_dismissed'
const COOLDOWN_DAYS = 14

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

function readDismissedAt() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? Number(raw) : 0
  } catch { return 0 }
}

/**
 * @param {{ streak?: number, savesCount?: number }} props
 */
export default function PremiumNudge({ streak = 0, savesCount = 0 }) {
  const { isPremium } = useSubscription()
  // Capture "now" once at mount — keeps render pure (React 19 lint).
  // For a multi-day-open session edge case the next mount refreshes it.
  const [nowAtMount] = useState(() => Date.now())
  // Local dismiss bump so dismiss-during-session takes effect even if
  // the localStorage write is throttled
  const [localDismissBump, setLocalDismissBump] = useState(0)

  function computeVisible() {
    if (isPremium) return false
    if (localDismissBump > 0) return false
    // Raised thresholds — at the previous 3-streak / 5-saves bar the
    // nudge fired on the user's very first testing session and
    // squeezed the Discover card off the viewport on iPhone. The
    // surface should reward sustained engagement, not test-driving.
    const meetsThreshold = streak >= 5 || savesCount >= 15
    if (!meetsThreshold) return false
    const dismissedAt = readDismissedAt()
    if (dismissedAt === 0) return true
    const ageDays = (nowAtMount - dismissedAt) / (24 * 60 * 60 * 1000)
    return ageDays > COOLDOWN_DAYS
  }
  const visible = computeVisible()

  const handleDismiss = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())) } catch { /* noop */ }
    setLocalDismissBump((b) => b + 1)
    track('upgrade-clicked', { surface: 'discover-nudge', authed: !isPremium, action: 'dismiss' })
  }, [isPremium])

  const handleTap = useCallback(() => {
    track('upgrade-clicked', { surface: 'discover-nudge', authed: !isPremium, action: 'open-pricing' })
  }, [isPremium])

  // Pick copy based on what signal surfaced the nudge — feels more
  // contextual than generic "Try ROAM+"
  const headline =
    streak >= 7 ? 'Loving the streak? Take it further.' :
    streak >= 3 ? "You're on a roll. Unlock the full ROAM+ toolkit." :
    savesCount >= 10 ? 'Save without limits' :
    'Unlock ROAM+'
  const supporting =
    streak >= 7 ? 'Unlimited saves, offline packs, posters of your map.' :
    streak >= 3 ? 'Unlock the offline pack for your next trip, plus unlimited saves.' :
    savesCount >= 10 ? 'Your wishlist deserves more than 10 slots — and offline packs are waiting.' :
    'Offline packs for trips. Unlimited saves. The full toolkit.'

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="premium-nudge"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          <Link to="/pricing" className="premium-nudge-body" onClick={handleTap}>
            <span className="premium-nudge-badge"><PremiumBadge size="md" /></span>
            <span className="premium-nudge-text">
              <span className="premium-nudge-headline">{headline}</span>
              <span className="premium-nudge-supporting">{supporting}</span>
            </span>
            <span className="premium-nudge-arrow" aria-hidden="true">→</span>
          </Link>
          <button
            className="premium-nudge-dismiss"
            onClick={handleDismiss}
            aria-label="Dismiss ROAM+ nudge"
          >
            <CloseIcon />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

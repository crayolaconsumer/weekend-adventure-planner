/**
 * BadgeToastWatcher
 *
 * Renders nothing; sits at the App.jsx root and continuously polls
 * useUserBadges. Whenever the earned-badges list grows, fires a toast
 * for each new badge — regardless of which page the user is on.
 *
 * Previously the badge-unlock toast detection lived inside
 * UnifiedProfile.jsx's mount useEffect, which meant:
 *   - The toast only fired when the user navigated TO their profile
 *   - Server-awarded badges (the canonical ones) were never toasted —
 *     only the now-deleted client BADGES were
 *   - A user who earned 'visits_10' after marking a place visited on
 *     Place.jsx would see no congratulation until they later happened
 *     to open Profile
 *
 * This watcher fixes all three: it lives at App root so it never
 * unmounts, it reads from useUserBadges (server source of truth), and
 * it uses SERVER_BADGE_CONFIG for the display name.
 *
 * Seen-badge tracking is per-device via localStorage so the user
 * doesn't re-see the toast for the same badge on every app launch.
 * It's keyed by user id so signing in as someone else doesn't suppress
 * their toasts.
 */

import { useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useUserBadges } from '../hooks/useUserBadges'
import { useToast } from '../hooks/useToast'
import { SERVER_BADGE_CONFIG } from '../pages/UnifiedProfile/badges'

const SEEN_BADGES_KEY_PREFIX = 'roam_seen_badges_'

function loadSeenBadges(userId) {
  if (!userId) return new Set()
  try {
    const raw = localStorage.getItem(SEEN_BADGES_KEY_PREFIX + userId)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

function saveSeenBadges(userId, set) {
  if (!userId) return
  try {
    localStorage.setItem(SEEN_BADGES_KEY_PREFIX + userId, JSON.stringify([...set]))
  } catch { /* storage unavailable — toast just refires next session */ }
}

export default function BadgeToastWatcher() {
  const { isAuthenticated, user } = useAuth()
  const { badges } = useUserBadges()
  const toast = useToast()
  // Track which badges we've shown a toast for in THIS session — guards
  // against firing duplicates when useUserBadges refreshes its list and
  // localStorage isn't immediately reflected.
  const toastedThisSession = useRef(new Set())
  // Bootstrap flag: on first run after login, treat the user's existing
  // badges as already-seen (don't spam them with a toast for every
  // historic badge). Only NEW awards after this point trigger toasts.
  const bootstrappedRef = useRef(false)

  useEffect(() => {
    if (!isAuthenticated || !user?.id || !badges) {
      bootstrappedRef.current = false
      toastedThisSession.current = new Set()
      return
    }

    const seen = loadSeenBadges(user.id)
    const earnedIds = badges.map(b => b.badgeId)

    // First run after auth for this user: seed seen-set with whatever
    // they already had, suppressing toasts for historic badges. Persist
    // immediately so a refresh doesn't re-trigger.
    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true
      // If localStorage was empty (new device / first install), seed
      // with the current set so we don't spam. Otherwise merge.
      earnedIds.forEach(id => seen.add(id))
      saveSeenBadges(user.id, seen)
      return
    }

    // Find genuinely-new badges (earned this session, never toasted).
    const newOnes = earnedIds.filter(id =>
      !seen.has(id) && !toastedThisSession.current.has(id)
    )

    if (newOnes.length === 0) return

    // Stagger toasts so multi-badge unlocks don't pile on each other.
    newOnes.forEach((badgeId, index) => {
      toastedThisSession.current.add(badgeId)
      const config = SERVER_BADGE_CONFIG[badgeId]
      const name = config?.name || badgeId.replace(/_/g, ' ')
      setTimeout(() => {
        toast.success(`Badge unlocked: ${name}`)
      }, index * 1200)
    })

    // Persist so a page reload doesn't replay the toasts.
    newOnes.forEach(id => seen.add(id))
    saveSeenBadges(user.id, seen)
  }, [isAuthenticated, user?.id, badges, toast])

  return null
}

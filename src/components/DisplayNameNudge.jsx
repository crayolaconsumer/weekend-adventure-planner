/**
 * DisplayNameNudge
 *
 * Inline banner that nudges authenticated users to set a real display
 * name when their stored value is missing or email-shaped.
 *
 * Persists dismissal in localStorage so the banner doesn't reappear
 * after the user explicitly opts out. Submitting a name silently clears
 * the dismissal too — once a real name is set, needsDisplayName returns
 * false anyway.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { needsDisplayName } from '../utils/displayName'
import './DisplayNameNudge.css'

const DISMISS_KEY = 'roam_display_name_nudge_dismissed_v1'

function getAuthHeaders() {
  const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export default function DisplayNameNudge() {
  const { user, isAuthenticated, checkAuth } = useAuth()
  const [dismissed, setDismissed] = useState(() => {
    try { return !!localStorage.getItem(DISMISS_KEY) } catch { return false }
  })
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Refresh the local "open" state when the underlying user/auth changes
  useEffect(() => {
    if (!isAuthenticated || !user) {
      setOpen(false)
      return
    }
    if (dismissed) {
      setOpen(false)
      return
    }
    setOpen(needsDisplayName(user))
  }, [user, isAuthenticated, dismissed])

  if (!open) return null

  const handleSave = async () => {
    const name = value.trim()
    if (!name) {
      setError('Please enter a name')
      return
    }
    if (name.includes('@')) {
      setError("That looks like an email — try your name instead")
      return
    }
    if (name.length > 50) {
      setError('Display names are limited to 50 characters')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ action: 'update', displayName: name })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save')
      }
      // Refresh auth state so the rest of the app picks up the new name
      if (typeof checkAuth === 'function') {
        await checkAuth()
      }
      setOpen(false)
    } catch (err) {
      setError(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
    setDismissed(true)
    setOpen(false)
  }

  return (
    <AnimatePresence>
      <motion.div
        className="display-name-nudge"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        role="dialog"
        aria-label="Set your display name"
      >
        <div className="display-name-nudge-inner">
          <div className="display-name-nudge-text">
            <strong>What should we call you?</strong>
            <span>Set a name so it's easier for friends to recognise you.</span>
          </div>
          <div className="display-name-nudge-form">
            <input
              type="text"
              className="display-name-nudge-input"
              placeholder="Your name"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={50}
              disabled={saving}
              aria-label="Display name"
            />
            <button
              type="button"
              className="display-name-nudge-save"
              onClick={handleSave}
              disabled={saving || !value.trim()}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              className="display-name-nudge-skip"
              onClick={handleDismiss}
              disabled={saving}
            >
              Maybe later
            </button>
          </div>
          {error && <p className="display-name-nudge-error">{error}</p>}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

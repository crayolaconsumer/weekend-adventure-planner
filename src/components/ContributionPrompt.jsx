/**
 * ContributionPrompt Component
 *
 * Prompts user to share what made a place special after visiting.
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { useCreateContribution } from '../hooks/useContributions'
import './ContributionPrompt.css'

const MAX_CHARS = 280

export default function ContributionPrompt({ place, onClose, onSuccess }) {
  const { isAuthenticated } = useAuth()
  const { createContribution, loading } = useCreateContribution()
  const [content, setContent] = useState('')
  const [error, setError] = useState(null)

  // Derive auth prompt state directly from isAuthenticated (no effect needed)
  const showAuthPrompt = !isAuthenticated

  const handleSubmit = async () => {
    if (!content.trim()) {
      setError('Please write something about your visit')
      return
    }

    setError(null)
    const result = await createContribution({
      placeId: place.id,
      type: 'tip',
      content: content.trim()
    })

    if (result.success) {
      onSuccess?.(result.contribution)
      onClose()
    } else {
      setError(result.error)
    }
  }

  const charsLeft = MAX_CHARS - content.length
  const isOverLimit = charsLeft < 0

  if (showAuthPrompt) {
    return (
      <motion.div
        className="contribution-prompt-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="contribution-prompt"
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          onClick={e => e.stopPropagation()}
        >
          <div className="contribution-prompt-header">
            <h2>Share Your Experience</h2>
          </div>

          <p className="contribution-prompt-description">
            Create a free account to share tips and help others discover what makes places special.
          </p>

          <div className="contribution-prompt-actions">
            <button className="contribution-btn-skip" onClick={onClose}>
              Maybe Later
            </button>
            <button
              className="contribution-btn-primary"
              onClick={() => {
                onClose()
                // Open auth modal - this will be handled by App.jsx's event listener
                window.dispatchEvent(new CustomEvent('openAuthModal', { detail: { mode: 'register' } }))
              }}
            >
              Sign Up Free
            </button>
          </div>
        </motion.div>
      </motion.div>
    )
  }

  return (
    <motion.div
      className="contribution-prompt-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="contribution-prompt"
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="contribution-prompt-header">
          <h2>What made it special?</h2>
        </div>

        <p className="contribution-prompt-place">
          You visited <strong>{place.name}</strong>
        </p>

        <div className="contribution-prompt-input-wrapper">
          <label htmlFor="contribution-input" className="visually-hidden">Your tip or insight about this place</label>
          <textarea
            id="contribution-input"
            className={`contribution-prompt-input ${isOverLimit ? 'error' : ''}`}
            placeholder="Share a tip, favorite dish, best time to visit, or what surprised you..."
            value={content}
            onChange={e => setContent(e.target.value)}
            maxLength={MAX_CHARS + 50} // Allow typing over to show error
            rows={4}
            autoFocus
            aria-describedby="contribution-char-count"
          />
          <span id="contribution-char-count" className={`contribution-char-count ${isOverLimit ? 'error' : charsLeft < 50 ? 'warning' : ''}`} aria-live="polite">
            {charsLeft} characters remaining
          </span>
        </div>

        <AnimatePresence>
          {error && (
            <motion.p
              className="contribution-error"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <div className="contribution-prompt-actions">
          <button className="contribution-btn-skip" onClick={onClose}>
            Skip
          </button>
          <button
            className="contribution-btn-primary"
            onClick={handleSubmit}
            disabled={loading || isOverLimit || !content.trim()}
          >
            {loading ? (
              <span className="contribution-loading-spinner" />
            ) : (
              'Share Tip'
            )}
          </button>
        </div>

        <p className="contribution-prompt-hint">
          Your tip helps others discover great places
        </p>
      </motion.div>
    </motion.div>
  )
}

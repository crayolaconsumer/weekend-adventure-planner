/**
 * ReportModal
 *
 * User-facing report flow for any UGC entity (contribution, user, photo).
 * Required by App Store Review Guideline 1.2.
 *
 * Lightweight modal — pick reason, optional detail, submit. We confirm
 * submission (and tell the user we aim to respond within 24h) but
 * don't surface review status; that's an operator concern.
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useToast } from '../hooks/useToast'
import './ReportModal.css'

const REASONS = [
  { value: 'spam',          label: 'Spam or scam' },
  { value: 'harassment',    label: 'Harassment or bullying' },
  { value: 'hate',          label: 'Hate speech' },
  { value: 'sexual',        label: 'Nudity or sexual content' },
  { value: 'violence',      label: 'Violence or threats' },
  { value: 'misinformation',label: 'False information' },
  { value: 'illegal',       label: 'Illegal activity' },
  { value: 'other',         label: 'Something else' },
]

export default function ReportModal({
  isOpen,
  entityType,         // 'contribution' | 'user' | 'photo' | 'review' | 'place'
  entityId,
  reportedUserId,     // optional — the author's user id if known
  entityLabel,        // human-readable hint shown in modal header
  onClose,
}) {
  const [reason, setReason] = useState(null)
  const [details, setDetails] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const focusTrapRef = useFocusTrap(isOpen)
  const toast = useToast()

  const handleSubmit = async () => {
    if (!reason) {
      setError('Please choose a reason')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/moderation/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ entityType, entityId, reportedUserId, reason, details: details.trim() || null })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to submit report')
      toast.success("Thanks — we'll review this within 24 hours.")
      onClose?.()
    } catch (err) {
      setError(err.message || 'Failed to submit report')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancel = () => {
    setReason(null); setDetails(''); setError(null)
    onClose?.()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="report-modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => e.target === e.currentTarget && handleCancel()}
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            ref={focusTrapRef}
            className="report-modal"
            initial={{ y: 30, scale: 0.96, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 30, scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          >
            <h3 className="report-modal-title">Report {entityLabel || entityType}</h3>
            <p className="report-modal-subtitle">
              What's going on? Reports are reviewed within 24 hours.
            </p>

            <div className="report-modal-reasons" role="radiogroup">
              {REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={reason === r.value}
                  className={`report-modal-reason ${reason === r.value ? 'selected' : ''}`}
                  onClick={() => setReason(r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <label htmlFor="report-details" className="report-modal-details-label">
              Any extra detail? (optional)
            </label>
            <textarea
              id="report-details"
              className="report-modal-details"
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
              maxLength={1000}
              rows={3}
              placeholder="What should we know?"
            />

            {error && <p className="report-modal-error">{error}</p>}

            <div className="report-modal-actions">
              <button
                type="button"
                className="report-modal-btn cancel"
                onClick={handleCancel}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="report-modal-btn submit"
                onClick={handleSubmit}
                disabled={submitting || !reason}
              >
                {submitting ? 'Submitting…' : 'Submit report'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

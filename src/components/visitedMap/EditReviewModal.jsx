/**
 * EditReviewModal
 *
 * Owner-only modal for editing recommend (5/1) + review text on a single
 * place. Reuses usePlaceRatings.ratePlace which UPSERTs to /api/places/ratings.
 *
 * Vibe / noise / value chips are NOT editable in v1 — the existing
 * ratings API only persists rating + review (vibe/noise/value live in
 * localStorage). Schema extension to persist them server-side is v1.1.
 */

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { usePlaceRatings } from '../../hooks/usePlaceRatings'
import './EditReviewModal.css'

const ThumbsUpIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
  </svg>
)
const ThumbsDownIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>
  </svg>
)

export default function EditReviewModal({ place, onClose, onSaved }) {
  const { getRating, ratePlace } = usePlaceRatings()
  const existing = place ? getRating(place.placeId) : null

  const initialRecommend = existing?.rating == null ? null : existing.rating > 3
  const [recommend, setRecommend] = useState(initialRecommend)
  const [reviewText, setReviewText] = useState(existing?.review || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!place) return
    const r = getRating(place.placeId)
    setRecommend(r?.rating == null ? null : r.rating > 3)
    setReviewText(r?.review || '')
  }, [place, getRating])

  if (!place) return null

  const handleSave = async () => {
    setSaving(true)
    try {
      await ratePlace(place.placeId, {
        recommended: recommend === true,
        review: reviewText.trim() || null,
        vibe: null,
        noiseLevel: null,
        valueForMoney: null,
        categoryKey: place.placeData?.category?.key || place.placeData?.category || null
      })
      onSaved?.(place.placeId)
      onClose?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        className="edit-review-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(e) => e.target === e.currentTarget && onClose?.()}
      >
        <motion.div
          className="edit-review-modal"
          initial={{ y: 20, scale: 0.96, opacity: 0 }}
          animate={{ y: 0, scale: 1, opacity: 1 }}
          exit={{ y: 20, scale: 0.96, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="edit-review-close" onClick={onClose} aria-label="Close">×</button>

          <h3 className="edit-review-title">Edit review</h3>
          <p className="edit-review-place">{place.placeData?.name || place.name || 'This place'}</p>

          <div className="edit-review-section">
            <span className="edit-review-label">Would you recommend it?</span>
            <div className="edit-review-rec-btns">
              <button
                type="button"
                className={`edit-review-rec ${recommend === true ? 'active positive' : ''}`}
                onClick={() => setRecommend(true)}
              >
                <ThumbsUpIcon /> Yes
              </button>
              <button
                type="button"
                className={`edit-review-rec ${recommend === false ? 'active negative' : ''}`}
                onClick={() => setRecommend(false)}
              >
                <ThumbsDownIcon /> Not really
              </button>
            </div>
          </div>

          <div className="edit-review-section">
            <label htmlFor="edit-review-text" className="edit-review-label">Review (optional)</label>
            <textarea
              id="edit-review-text"
              className="edit-review-textarea"
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value.slice(0, 500))}
              maxLength={500}
              rows={4}
              placeholder="Share what you remember about this place..."
            />
            <span className="edit-review-charcount">{reviewText.length}/500</span>
          </div>

          <div className="edit-review-actions">
            <button type="button" className="edit-review-cancel" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="edit-review-save"
              onClick={handleSave}
              disabled={saving || recommend === null}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

/**
 * ConfirmModal
 *
 * Reusable confirm-or-cancel modal — replaces window.confirm() for native
 * compatibility (iOS WKWebView shows system alerts that break visual
 * continuity). Match the project's bottom-sheet-on-mobile / centered-on-
 * desktop pattern (see EditReviewModal.css for the same shape).
 *
 * Usage:
 *   const [open, setOpen] = useState(false)
 *   <ConfirmModal
 *     isOpen={open}
 *     title="Clear your offline pack?"
 *     message="You can download a new one any time."
 *     confirmLabel="Clear"
 *     destructive
 *     onConfirm={() => { doIt(); setOpen(false) }}
 *     onCancel={() => setOpen(false)}
 *   />
 */

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFocusTrap } from '../hooks/useFocusTrap'
import './ConfirmModal.css'

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}) {
  const focusTrapRef = useFocusTrap(isOpen)

  // Close on Escape key — matches native cancel behaviour
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onCancel])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="confirm-modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => e.target === e.currentTarget && onCancel?.()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
        >
          <motion.div
            ref={focusTrapRef}
            className="confirm-modal"
            initial={{ y: 30, scale: 0.96, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 30, scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="confirm-modal-title" className="confirm-modal-title">{title}</h3>
            {message && <p className="confirm-modal-message">{message}</p>}
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="confirm-modal-btn confirm-modal-btn-cancel"
                onClick={onCancel}
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                className={`confirm-modal-btn confirm-modal-btn-confirm ${destructive ? 'destructive' : ''}`}
                onClick={onConfirm}
                autoFocus
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

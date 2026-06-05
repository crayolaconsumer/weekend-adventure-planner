/**
 * ConfirmDialog — a small branded modal that replaces window.confirm() in the
 * partner portal. Escape / overlay-click cancels; the confirm button autofocuses,
 * Tab is trapped inside, and focus returns to the trigger on close.
 */

import { useEffect, useRef } from 'react'

export default function ConfirmDialog({
  open, title, body,
  confirmLabel = 'Confirm', cancelLabel = 'Keep', busyLabel,
  danger = false, busy = false, onConfirm, onCancel
}) {
  const confirmRef = useRef(null)
  const dialogRef = useRef(null)
  const triggerRef = useRef(null)

  // Capture the opener once on the open transition, focus the confirm button,
  // and restore focus to the opener on close (depends on `open` ONLY so a
  // re-render from changing props doesn't re-capture the confirm button).
  useEffect(() => {
    if (!open) return
    triggerRef.current = document.activeElement
    confirmRef.current?.focus()
    return () => triggerRef.current?.focus?.()
  }, [open])

  // Escape cancels; Tab is trapped within the dialog (aria-modal alone doesn't
  // stop the browser tab sequence reaching the still-rendered page behind it).
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') { onCancel?.(); return }
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const focusables = root.querySelectorAll(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="partners-modal-overlay" role="presentation" onClick={onCancel}>
      <div ref={dialogRef} className="partners-modal" role="dialog" aria-modal="true"
        aria-labelledby="pcd-title" aria-describedby={body ? 'pcd-body' : undefined}
        onClick={(e) => e.stopPropagation()}>
        <h3 id="pcd-title" className="partners-modal-title">{title}</h3>
        {body && <div id="pcd-body" className="partners-modal-body">{body}</div>}
        <div className="partners-modal-actions">
          <button className="partners-btn ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button ref={confirmRef} className={`partners-btn ${danger ? 'danger-solid' : 'primary'}`}
            onClick={onConfirm} disabled={busy}>
            {busy ? (busyLabel || confirmLabel) : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

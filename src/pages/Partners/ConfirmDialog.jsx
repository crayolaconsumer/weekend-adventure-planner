/**
 * ConfirmDialog — a small branded modal that replaces window.confirm() in the
 * partner portal. Escape / overlay-click cancels; the confirm button autofocuses.
 */

import { useEffect, useRef } from 'react'

export default function ConfirmDialog({
  open, title, body,
  confirmLabel = 'Confirm', cancelLabel = 'Keep',
  danger = false, busy = false, onConfirm, onCancel
}) {
  const confirmRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.() }
    window.addEventListener('keydown', onKey)
    confirmRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="partners-modal-overlay" role="presentation" onClick={onCancel}>
      <div className="partners-modal" role="dialog" aria-modal="true" aria-labelledby="pcd-title"
        onClick={(e) => e.stopPropagation()}>
        <h3 id="pcd-title" className="partners-modal-title">{title}</h3>
        {body && <p className="partners-modal-body">{body}</p>}
        <div className="partners-modal-actions">
          <button className="partners-btn ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button ref={confirmRef} className={`partners-btn ${danger ? 'danger-solid' : 'primary'}`}
            onClick={onConfirm} disabled={busy}>
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

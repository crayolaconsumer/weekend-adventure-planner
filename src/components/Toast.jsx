import { useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ToastContext } from '../contexts/ToastContext'
import './Toast.css'

// Toast icons
const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

const AlertIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
)

const InfoIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="16" x2="12" y2="12"/>
    <line x1="12" y1="8" x2="12.01" y2="8"/>
  </svg>
)

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const ICONS = {
  success: CheckIcon,
  error: AlertIcon,
  info: InfoIcon
}

// Individual Toast component
function ToastItem({ id, type, message, onDismiss }) {
  const Icon = ICONS[type] || InfoIcon

  return (
    <motion.div
      className={`toast toast-${type}`}
      initial={{ opacity: 0, y: 50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 100, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      layout
    >
      <div className="toast-icon">
        <Icon />
      </div>
      <span className="toast-message">{message}</span>
      <button className="toast-close" onClick={() => onDismiss(id)}>
        <CloseIcon />
      </button>
    </motion.div>
  )
}

// Toast Container (renders all toasts)
function ToastContainer({ toasts, onDismiss }) {
  return (
    <div className="toast-container">
      <AnimatePresence mode="popLayout">
        {toasts.map(toast => (
          <ToastItem
            key={toast.id}
            {...toast}
            onDismiss={onDismiss}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}

// Toast Provider
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random()

    setToasts(prev => [...prev, { id, message, type }])

    // Auto-dismiss
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, duration)
    }

    return id
  }, [])

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // Memoize toast methods to prevent unnecessary re-renders
  const toast = useMemo(() => Object.assign(
    (msg, type, duration) => addToast(msg, type, duration),
    {
      success: (msg, duration) => addToast(msg, 'success', duration),
      error: (msg, duration) => addToast(msg, 'error', duration),
      info: (msg, duration) => addToast(msg, 'info', duration)
    }
  ), [addToast])

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo(() => ({
    toast,
    dismissToast
  }), [toast, dismissToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  )
}

export default ToastProvider

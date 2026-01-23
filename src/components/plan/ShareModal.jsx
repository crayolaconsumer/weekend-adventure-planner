/**
 * ShareModal - Share and export adventure plans
 *
 * Provides options to:
 * - Copy link to clipboard
 * - Share via native share sheet
 * - Export to calendar (.ics)
 * - Export to Google Calendar
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { downloadICS, getGoogleCalendarUrl } from './CalendarExport'
import './ShareModal.css'

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const LinkIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
  </svg>
)

const ShareIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
    <polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
  </svg>
)

const CalendarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
)

const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
)

const CheckIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

export default function ShareModal({ isOpen, onClose, itinerary, vibe, shareCode }) {
  const [copied, setCopied] = useState(false)

  if (!isOpen) return null

  const planTitle = `${vibe || 'My'} ROAM Adventure`
  const shareText = `Check out my ${vibe || ''} adventure with ${itinerary?.length || 0} stops!`
  // Use share link if we have a shareCode, otherwise current URL
  const shareUrl = shareCode
    ? `${window.location.origin}/plan/share/${shareCode}`
    : window.location.href

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = `${shareText}\n${shareUrl}`
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: planTitle,
          text: shareText,
          url: shareUrl
        })
      } catch {
        /* user cancelled */
      }
    }
  }

  const handleCalendarExport = () => {
    downloadICS(itinerary, planTitle)
  }

  const handleGoogleCalendar = () => {
    // For Google Calendar, we'll add the first stop
    // (full plan would need multiple adds)
    if (itinerary && itinerary.length > 0) {
      const url = getGoogleCalendarUrl(itinerary[0])
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        className="share-modal-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="share-modal"
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-modal-title"
        >
          <div className="share-modal-header">
            <h2 id="share-modal-title" className="share-modal-title">Share Adventure</h2>
            <button className="share-modal-close" onClick={onClose} aria-label="Close">
              <CloseIcon />
            </button>
          </div>

          <div className="share-modal-body">
            <p className="share-modal-subtitle">
              Share your {itinerary?.length || 0}-stop adventure with friends
            </p>

            <div className="share-modal-options">
              {/* Copy Link */}
              <button className="share-option" onClick={handleCopyLink}>
                <span className="share-option-icon">
                  {copied ? <CheckIcon /> : <LinkIcon />}
                </span>
                <span className="share-option-text">
                  <span className="share-option-label">
                    {copied ? 'Copied!' : 'Copy Link'}
                  </span>
                  <span className="share-option-desc">Share via any app</span>
                </span>
              </button>

              {/* Native Share (mobile) */}
              {navigator.share && (
                <button className="share-option" onClick={handleNativeShare}>
                  <span className="share-option-icon"><ShareIcon /></span>
                  <span className="share-option-text">
                    <span className="share-option-label">Share</span>
                    <span className="share-option-desc">Open share menu</span>
                  </span>
                </button>
              )}

              {/* Divider */}
              <div className="share-modal-divider">
                <span>Export to Calendar</span>
              </div>

              {/* Download .ics */}
              <button className="share-option" onClick={handleCalendarExport}>
                <span className="share-option-icon"><CalendarIcon /></span>
                <span className="share-option-text">
                  <span className="share-option-label">Download .ics</span>
                  <span className="share-option-desc">Apple Calendar, Outlook</span>
                </span>
              </button>

              {/* Google Calendar */}
              <button className="share-option" onClick={handleGoogleCalendar}>
                <span className="share-option-icon"><GoogleIcon /></span>
                <span className="share-option-text">
                  <span className="share-option-label">Google Calendar</span>
                  <span className="share-option-desc">Add first stop to calendar</span>
                </span>
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

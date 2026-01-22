/**
 * Share Button Component
 *
 * Provides sharing functionality for places with download and share options.
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { generatePlaceCard, shareContent, downloadBlob } from '../utils/shareCard'
import './ShareButton.css'

// Icons
const ShareIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3"/>
    <circle cx="6" cy="12" r="3"/>
    <circle cx="18" cy="19" r="3"/>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
  </svg>
)

const DownloadIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
)

const CopyIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
)

const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

export default function ShareButton({ place, variant = 'icon' }) {
  const [showMenu, setShowMenu] = useState(false)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const shareUrl = `${window.location.origin}/place/${place.id}`
  const shareTitle = place.name
  const shareText = place.description
    ? `Check out ${place.name}: "${place.description}"`
    : `Check out ${place.name} on ROAM`

  const handleShare = async () => {
    setLoading(true)
    try {
      const success = await shareContent({
        title: shareTitle,
        text: shareText,
        url: shareUrl
      })

      if (success) {
        setShowMenu(false)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadImage = async () => {
    setLoading(true)
    try {
      const blob = await generatePlaceCard(place)
      const filename = `roam-${place.name.toLowerCase().replace(/\s+/g, '-')}.png`
      downloadBlob(blob, filename)
      setShowMenu(false)
    } catch (err) {
      console.error('Failed to generate share image:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => {
        setCopied(false)
        setShowMenu(false)
      }, 1500)
    } catch (err) {
      console.error('Failed to copy link:', err)
    }
  }

  return (
    <div className="share-button-container">
      <motion.button
        className={`share-button share-button-${variant}`}
        onClick={() => setShowMenu(!showMenu)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Share this place"
      >
        <ShareIcon />
        {variant === 'full' && <span>Share</span>}
      </motion.button>

      <AnimatePresence>
        {showMenu && (
          <>
            {/* Backdrop */}
            <motion.div
              className="share-menu-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMenu(false)}
            />

            {/* Menu */}
            <motion.div
              className="share-menu"
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 10 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            >
              <div className="share-menu-header">
                <h4>Share {place.name}</h4>
                <button className="share-menu-close" onClick={() => setShowMenu(false)} aria-label="Close share menu">
                  <CloseIcon />
                </button>
              </div>

              <div className="share-menu-options">
                {/* Native share */}
                {navigator.share && (
                  <button
                    className="share-menu-option"
                    onClick={handleShare}
                    disabled={loading}
                  >
                    <ShareIcon />
                    <span>Share</span>
                  </button>
                )}

                {/* Download image */}
                <button
                  className="share-menu-option"
                  onClick={handleDownloadImage}
                  disabled={loading}
                >
                  <DownloadIcon />
                  <span>Download Image</span>
                </button>

                {/* Copy link */}
                <button
                  className="share-menu-option"
                  onClick={handleCopyLink}
                  disabled={loading}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  <span>{copied ? 'Copied!' : 'Copy Link'}</span>
                </button>
              </div>

              {loading && (
                <div className="share-menu-loading">
                  <div className="share-menu-spinner" />
                  <span>Generating...</span>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * PhotoUpload Component
 *
 * Simple photo upload component for contributions.
 * Uploads to /api/contributions/upload and returns the URL.
 */

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import './PhotoUpload.css'

// Get auth token for upload
function getAuthToken() {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

export default function PhotoUpload({ onUpload, onRemove, currentUrl, disabled }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)
  const tokenRef = useRef(null)
  const lastFileRef = useRef(null)

  // Cache auth token on mount and when it might change
  useEffect(() => {
    tokenRef.current = getAuthToken()
  }, [])

  const handleFile = async (file) => {
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file')
      return
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be under 5MB')
      return
    }

    // Store file reference for potential retry
    lastFileRef.current = file

    setUploading(true)
    setError(null)

    try {
      // Use cached token, fallback to fresh read if needed
      const token = tokenRef.current || getAuthToken()
      const response = await fetch('/api/contributions/upload', {
        method: 'POST',
        headers: {
          'Content-Type': file.type,
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        credentials: 'include',
        body: file
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed')
      }

      onUpload(data.url)
    } catch (err) {
      console.error('Upload error:', err)
      setError(err.message || 'Failed to upload photo')
    } finally {
      setUploading(false)
    }
  }

  const handleChange = (e) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = () => {
    setDragOver(false)
  }

  const handleClick = () => {
    inputRef.current?.click()
  }

  const handleRemove = () => {
    onRemove?.()
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }

  const handleRetry = (e) => {
    e.stopPropagation() // Prevent triggering the parent click handler
    if (lastFileRef.current) {
      handleFile(lastFileRef.current)
    } else {
      // If no file stored, just reset error state to allow new selection
      setError(null)
    }
  }

  // Show preview if we have a URL
  if (currentUrl) {
    return (
      <div className="photo-upload has-photo">
        <img src={currentUrl} alt="Uploaded photo" className="photo-upload-preview" />
        <button
          type="button"
          className="photo-upload-remove"
          onClick={handleRemove}
          disabled={disabled}
          aria-label="Remove photo"
        >
          ×
        </button>
      </div>
    )
  }

  return (
    <div
      className={`photo-upload ${dragOver ? 'drag-over' : ''} ${uploading ? 'uploading' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      aria-label="Upload photo"
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleChange}
        disabled={disabled || uploading}
        className="photo-upload-input"
      />

      <AnimatePresence mode="wait">
        {uploading ? (
          <motion.div
            key="uploading"
            className="photo-upload-content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="photo-upload-spinner" />
            <span>Uploading...</span>
          </motion.div>
        ) : (
          <motion.div
            key="idle"
            className="photo-upload-content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <span className="photo-upload-icon">📷</span>
            <span className="photo-upload-text">Add Photo</span>
            <span className="photo-upload-hint">Tap or drag to upload</span>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <motion.div
          className="photo-upload-error"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <span className="photo-upload-error-text">{error}</span>
          <button
            type="button"
            className="photo-upload-retry"
            onClick={handleRetry}
            disabled={disabled}
          >
            Retry
          </button>
        </motion.div>
      )}
    </div>
  )
}

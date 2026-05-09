/**
 * PhotoUpload Component
 *
 * Simple photo upload component for contributions.
 * Uploads to /api/contributions/upload and returns the URL.
 */

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { compressImage } from '../utils/compressImage'
import './PhotoUpload.css'

// Get auth token for upload
function getAuthToken() {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

export default function PhotoUpload({ onUpload, onRemove, currentUrl, disabled }) {
  const [uploading, setUploading] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
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

    // Hard ceiling — beyond this we risk browser OOM during decode
    if (file.size > 25 * 1024 * 1024) {
      setError('Image is too large (over 25MB). Try a smaller photo.')
      return
    }

    // Store original file for retry — re-compression is cheap, no need to cache result
    lastFileRef.current = file
    setError(null)

    let uploadFile = file
    try {
      // Compress oversized images before upload. Modern phone cameras (Pixel,
      // iPhone) routinely produce 8-15MB photos, well over the 5MB server cap.
      // Transparent compression keeps the user flow uninterrupted.
      if (file.size > 4 * 1024 * 1024) {
        setOptimizing(true)
        uploadFile = await compressImage(file)
        setOptimizing(false)

        if (uploadFile.size > 5 * 1024 * 1024) {
          throw new Error('Photo too large to upload even after optimisation. Try a smaller image.')
        }
      }

      setUploading(true)

      const token = tokenRef.current || getAuthToken()
      const response = await fetch('/api/contributions/upload', {
        method: 'POST',
        headers: {
          'Content-Type': uploadFile.type,
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        credentials: 'include',
        body: uploadFile
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
      setOptimizing(false)
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
      className={`photo-upload ${dragOver ? 'drag-over' : ''} ${(uploading || optimizing) ? 'uploading' : ''}`}
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
        disabled={disabled || uploading || optimizing}
        className="photo-upload-input"
      />

      <AnimatePresence mode="wait">
        {optimizing ? (
          <motion.div
            key="optimizing"
            className="photo-upload-content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="photo-upload-spinner" />
            <span>Optimising photo...</span>
          </motion.div>
        ) : uploading ? (
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

/**
 * Create Collection Form
 *
 * Modal form for creating a new collection.
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createCollection, COLLECTION_EMOJIS } from '../utils/collections'
import './CreateCollectionForm.css'

// Icons
const CloseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

export default function CreateCollectionForm({ isOpen, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [emoji, setEmoji] = useState(COLLECTION_EMOJIS[0])
  const [error, setError] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()

    if (!name.trim()) {
      setError('Please enter a collection name')
      return
    }

    if (name.length > 50) {
      setError('Name must be 50 characters or less')
      return
    }

    try {
      createCollection({
        name: name.trim(),
        description: description.trim(),
        emoji
      })

      // Reset form
      setName('')
      setDescription('')
      setEmoji(COLLECTION_EMOJIS[0])
      setError('')

      onCreated?.()
    } catch (err) {
      setError('Failed to create collection')
    }
  }

  const handleClose = () => {
    setName('')
    setDescription('')
    setEmoji(COLLECTION_EMOJIS[0])
    setError('')
    onClose()
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        className="create-collection-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleClose}
      >
        <motion.div
          className="create-collection-modal"
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="create-collection-header">
            <h2>Create Collection</h2>
            <button className="create-collection-close" onClick={handleClose}>
              <CloseIcon />
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Emoji picker */}
            <div className="create-collection-field">
              <label>Choose an icon</label>
              <div className="create-collection-emojis">
                {COLLECTION_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className={`create-collection-emoji ${emoji === e ? 'selected' : ''}`}
                    onClick={() => setEmoji(e)}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            {/* Name input */}
            <div className="create-collection-field">
              <label htmlFor="collection-name">Name</label>
              <input
                id="collection-name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setError('')
                }}
                placeholder="Coffee Spots, Date Night Ideas..."
                maxLength={50}
                autoFocus
              />
            </div>

            {/* Description input */}
            <div className="create-collection-field">
              <label htmlFor="collection-desc">Description (optional)</label>
              <textarea
                id="collection-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What's this collection about?"
                maxLength={200}
                rows={2}
              />
            </div>

            {error && (
              <div className="create-collection-error">{error}</div>
            )}

            <button type="submit" className="create-collection-submit">
              Create Collection
            </button>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

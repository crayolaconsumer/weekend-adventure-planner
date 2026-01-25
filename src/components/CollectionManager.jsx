/**
 * Collection Manager Component
 *
 * Modal for adding a place to collections or creating new collections.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCollections } from '../hooks/useCollections'
import { COLLECTION_EMOJIS } from '../utils/collections'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useToast } from '../hooks/useToast'
import { useSubscription } from '../hooks/useSubscription'
import UpgradePrompt from './UpgradePrompt'
import './CollectionManager.css'

// Icons
const PlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)

const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

// Free tier collection limit
const FREE_COLLECTION_LIMIT = 3

export default function CollectionManager({ place, isOpen, onClose }) {
  const toast = useToast()
  const { isPremium } = useSubscription()
  const {
    collections,
    createCollection,
    addPlaceToCollection,
    removePlaceFromCollection,
    getCollectionsForPlace
  } = useCollections()
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newCollectionName, setNewCollectionName] = useState('')
  const [selectedEmoji, setSelectedEmoji] = useState('📍')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false)

  // Check if user can create more collections
  const canCreateCollection = isPremium || collections.length < FREE_COLLECTION_LIMIT

  // Focus trap for accessibility
  const focusTrapRef = useFocusTrap(isOpen)

  // Get collections that contain this place
  const placeCollections = getCollectionsForPlace(place.id).map(c => c.id)

  // Handle escape key to close
  useEffect(() => {
    if (!isOpen) return

    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  const handleToggleCollection = async (collectionId) => {
    const collection = collections.find(c => c.id === collectionId)
    if (placeCollections.includes(collectionId)) {
      await removePlaceFromCollection(collectionId, place.id)
      toast.success(`Removed from ${collection?.name || 'collection'}`)
    } else {
      await addPlaceToCollection(collectionId, place.id, place)
      toast.success(`Added to ${collection?.name || 'collection'}`)
    }
  }

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) return

    const newCollection = await createCollection({
      name: newCollectionName.trim(),
      emoji: selectedEmoji
    })

    // Add place to new collection
    if (newCollection) {
      toast.success(`Created "${newCollectionName.trim()}"`)
      await addPlaceToCollection(newCollection.id, place.id, place)
    } else {
      toast.error('Failed to create collection')
    }

    // Reset form
    setNewCollectionName('')
    setSelectedEmoji('📍')
    setShowCreateForm(false)
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        className="collection-manager-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          ref={focusTrapRef}
          className="collection-manager"
          role="dialog"
          aria-modal="true"
          aria-labelledby="collection-manager-title"
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <div className="collection-manager-header">
            <h3 id="collection-manager-title">Add to Collection</h3>
            <button className="collection-manager-close" onClick={onClose} aria-label="Close collection manager">
              <CloseIcon />
            </button>
          </div>

          <div className="collection-manager-place">
            {place.category?.icon && <span>{place.category.icon}</span>}
            <span>{place.name}</span>
          </div>

          <div className="collection-manager-content">
            {/* Existing collections */}
            {collections.length > 0 && (
              <div className="collection-manager-list">
                {collections.map(collection => (
                  <button
                    key={collection.id}
                    className={`collection-manager-item ${placeCollections.includes(collection.id) ? 'selected' : ''}`}
                    onClick={() => handleToggleCollection(collection.id)}
                  >
                    <span className="collection-item-emoji">{collection.emoji}</span>
                    <span className="collection-item-name">{collection.name}</span>
                    <span className="collection-item-count">{collection.places.length}</span>
                    {placeCollections.includes(collection.id) && (
                      <span className="collection-item-check">
                        <CheckIcon />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Create new collection */}
            {!showCreateForm ? (
              <button
                className="collection-manager-create-btn"
                onClick={() => {
                  if (!canCreateCollection) {
                    setShowUpgradePrompt(true)
                    return
                  }
                  setShowCreateForm(true)
                }}
              >
                <PlusIcon />
                <span>Create New Collection</span>
                {!canCreateCollection && (
                  <span className="collection-limit-badge">PRO</span>
                )}
              </button>
            ) : (
              <div className="collection-manager-form">
                <div className="collection-form-row">
                  <button
                    className="collection-emoji-picker-btn"
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  >
                    {selectedEmoji}
                  </button>
                  <input
                    type="text"
                    placeholder="Collection name"
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateCollection()}
                    autoFocus
                    maxLength={40}
                    aria-label="Collection name"
                  />
                </div>

                {showEmojiPicker && (
                  <div className="collection-emoji-grid">
                    {COLLECTION_EMOJIS.map(emoji => (
                      <button
                        key={emoji}
                        className={`collection-emoji-option ${selectedEmoji === emoji ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedEmoji(emoji)
                          setShowEmojiPicker(false)
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}

                <div className="collection-form-actions">
                  <button
                    className="collection-form-cancel"
                    onClick={() => {
                      setShowCreateForm(false)
                      setNewCollectionName('')
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="collection-form-submit"
                    onClick={handleCreateCollection}
                    disabled={!newCollectionName.trim()}
                  >
                    Create
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Done button */}
          <div className="collection-manager-footer">
            <button className="collection-manager-done" onClick={onClose}>
              Done
            </button>
          </div>
        </motion.div>
      </motion.div>

      {/* Upgrade prompt for collection limit */}
      <UpgradePrompt
        type="collections"
        isOpen={showUpgradePrompt}
        onClose={() => setShowUpgradePrompt(false)}
      />
    </AnimatePresence>
  )
}

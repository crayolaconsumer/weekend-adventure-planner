/**
 * Collection Manager Component
 *
 * Modal for adding a place to collections or creating new collections.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  getAllCollections,
  createCollection,
  addPlaceToCollection,
  removePlaceFromCollection,
  getCollectionsForPlace,
  COLLECTION_EMOJIS
} from '../utils/collections'
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

export default function CollectionManager({ place, isOpen, onClose }) {
  const [collections, setCollections] = useState([])
  const [placeCollections, setPlaceCollections] = useState([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newCollectionName, setNewCollectionName] = useState('')
  const [selectedEmoji, setSelectedEmoji] = useState('📍')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)

  // Load collections on mount
  useEffect(() => {
    if (isOpen) {
      setCollections(getAllCollections())
      setPlaceCollections(getCollectionsForPlace(place.id).map(c => c.id))
    }
  }, [isOpen, place.id])

  const handleToggleCollection = (collectionId) => {
    if (placeCollections.includes(collectionId)) {
      // Remove from collection
      removePlaceFromCollection(collectionId, place.id)
      setPlaceCollections(prev => prev.filter(id => id !== collectionId))
    } else {
      // Add to collection
      addPlaceToCollection(collectionId, place.id)
      setPlaceCollections(prev => [...prev, collectionId])
    }
  }

  const handleCreateCollection = () => {
    if (!newCollectionName.trim()) return

    const newCollection = createCollection({
      name: newCollectionName.trim(),
      emoji: selectedEmoji
    })

    // Add place to new collection
    addPlaceToCollection(newCollection.id, place.id)

    // Update state
    setCollections(prev => [...prev, newCollection])
    setPlaceCollections(prev => [...prev, newCollection.id])

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
          className="collection-manager"
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <div className="collection-manager-header">
            <h3>Add to Collection</h3>
            <button className="collection-manager-close" onClick={onClose}>
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
                onClick={() => setShowCreateForm(true)}
              >
                <PlusIcon />
                <span>Create New Collection</span>
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
    </AnimatePresence>
  )
}

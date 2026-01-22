/**
 * Collections Page
 *
 * View and manage user-created collections of places.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, useNavigate } from 'react-router-dom'
import {
  getAllCollections,
  deleteCollection,
  removePlaceFromCollection,
  COLLECTION_EMOJIS
} from '../utils/collections'
import CreateCollectionForm from '../components/CreateCollectionForm'
import './Collections.css'

// Icons
const BackIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
)

const PlusIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)

const TrashIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
  </svg>
)

const ChevronRightIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
)

export default function Collections() {
  const navigate = useNavigate()
  const [collections, setCollections] = useState([])
  const [selectedCollection, setSelectedCollection] = useState(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null)

  const loadCollections = () => {
    const allCollections = getAllCollections()
    setCollections(allCollections)
  }

  // Load collections on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial data load
    loadCollections()
  }, [])

  const handleCreateCollection = () => {
    loadCollections()
    setShowCreateForm(false)
  }

  const handleDeleteCollection = (collectionId) => {
    deleteCollection(collectionId)
    loadCollections()
    setShowDeleteConfirm(null)
    if (selectedCollection?.id === collectionId) {
      setSelectedCollection(null)
    }
  }

  const handleRemovePlace = (collectionId, placeId) => {
    removePlaceFromCollection(collectionId, placeId)
    loadCollections()
    // Update selected collection if viewing it
    if (selectedCollection?.id === collectionId) {
      const updated = getAllCollections().find(c => c.id === collectionId)
      setSelectedCollection(updated)
    }
  }

  // Collection detail view
  if (selectedCollection) {
    return (
      <div className="collections-page">
        <header className="collections-header">
          <button className="collections-back-btn" onClick={() => setSelectedCollection(null)}>
            <BackIcon />
          </button>
          <div className="collections-header-info">
            <span className="collections-header-emoji">{selectedCollection.emoji}</span>
            <h1 className="collections-title">{selectedCollection.name}</h1>
          </div>
          <button
            className="collections-delete-btn"
            onClick={() => setShowDeleteConfirm(selectedCollection.id)}
          >
            <TrashIcon />
          </button>
        </header>

        {selectedCollection.description && (
          <p className="collections-description">{selectedCollection.description}</p>
        )}

        <div className="collections-place-count">
          {selectedCollection.places.length} {selectedCollection.places.length === 1 ? 'place' : 'places'}
        </div>

        {selectedCollection.places.length === 0 ? (
          <div className="collections-empty">
            <p>No places in this collection yet</p>
            <Link to="/" className="collections-discover-btn">
              Discover Places
            </Link>
          </div>
        ) : (
          <div className="collections-places-list">
            <AnimatePresence>
              {selectedCollection.places.map((item, index) => (
                <motion.div
                  key={item.placeId}
                  className="collections-place-item"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <div className="collections-place-info">
                    <span className="collections-place-name">{item.placeName || item.placeId}</span>
                    {item.note && (
                      <span className="collections-place-note">{item.note}</span>
                    )}
                  </div>
                  <button
                    className="collections-remove-btn"
                    onClick={() => handleRemovePlace(selectedCollection.id, item.placeId)}
                  >
                    <TrashIcon />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Delete confirmation */}
        <AnimatePresence>
          {showDeleteConfirm && (
            <motion.div
              className="collections-confirm-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDeleteConfirm(null)}
            >
              <motion.div
                className="collections-confirm-modal"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
              >
                <h3>Delete Collection?</h3>
                <p>This action cannot be undone.</p>
                <div className="collections-confirm-buttons">
                  <button
                    className="collections-confirm-cancel"
                    onClick={() => setShowDeleteConfirm(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="collections-confirm-delete"
                    onClick={() => handleDeleteCollection(showDeleteConfirm)}
                  >
                    Delete
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  // Collections list view
  return (
    <div className="collections-page">
      <header className="collections-header">
        <button className="collections-back-btn" onClick={() => navigate('/wishlist')}>
          <BackIcon />
        </button>
        <h1 className="collections-title">My Collections</h1>
        <button
          className="collections-add-btn"
          onClick={() => setShowCreateForm(true)}
        >
          <PlusIcon />
        </button>
      </header>

      {collections.length === 0 ? (
        <div className="collections-empty">
          <span className="collections-empty-icon">📁</span>
          <h3>No collections yet</h3>
          <p>Create a collection to organize your favorite places</p>
          <button
            className="collections-create-btn"
            onClick={() => setShowCreateForm(true)}
          >
            <PlusIcon />
            Create Collection
          </button>
        </div>
      ) : (
        <div className="collections-grid">
          <AnimatePresence>
            {collections.map((collection, index) => (
              <motion.button
                key={collection.id}
                className="collections-card"
                onClick={() => setSelectedCollection(collection)}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <span className="collections-card-emoji">{collection.emoji}</span>
                <div className="collections-card-info">
                  <span className="collections-card-name">{collection.name}</span>
                  <span className="collections-card-count">
                    {collection.places.length} {collection.places.length === 1 ? 'place' : 'places'}
                  </span>
                </div>
                <ChevronRightIcon />
              </motion.button>
            ))}
          </AnimatePresence>

          {/* Add new collection button */}
          <motion.button
            className="collections-card collections-card-add"
            onClick={() => setShowCreateForm(true)}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: collections.length * 0.05 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <PlusIcon />
            <span>New Collection</span>
          </motion.button>
        </div>
      )}

      {/* Create collection form */}
      <CreateCollectionForm
        isOpen={showCreateForm}
        onClose={() => setShowCreateForm(false)}
        onCreated={handleCreateCollection}
      />
    </div>
  )
}

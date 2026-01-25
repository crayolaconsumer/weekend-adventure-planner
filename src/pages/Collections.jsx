/**
 * Collections Page
 *
 * View and manage user-created collections of places.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, useNavigate } from 'react-router-dom'
import { useCollections } from '../hooks/useCollections'
import { COLLECTION_EMOJIS } from '../utils/collections'
import CreateCollectionForm from '../components/CreateCollectionForm'
import { useSubscription } from '../hooks/useSubscription'
import { useToast } from '../hooks/useToast'
import UpgradePrompt from '../components/UpgradePrompt'
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

// Pagination constant
const PAGE_SIZE = 15

export default function Collections() {
  const navigate = useNavigate()
  const toast = useToast()
  const { collections, deleteCollection, removePlaceFromCollection, refresh: loadCollections } = useCollections()
  const [selectedCollection, setSelectedCollection] = useState(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null)
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false)
  const [placesDisplayLimit, setPlacesDisplayLimit] = useState(PAGE_SIZE)
  const { isPremium } = useSubscription()

  // Update selectedCollection when collections change
  useEffect(() => {
    if (selectedCollection) {
      const updated = collections.find(c => c.id === selectedCollection.id)
      if (updated) {
        setSelectedCollection(updated)
      } else {
        setSelectedCollection(null)
      }
    }
  }, [collections, selectedCollection?.id])

  const handleCreateCollection = () => {
    setShowCreateForm(false)
    toast.success('Collection created')
  }

  const handleDeleteCollection = async (collectionId) => {
    const collection = collections.find(c => c.id === collectionId)
    await deleteCollection(collectionId)
    setShowDeleteConfirm(null)
    if (selectedCollection?.id === collectionId) {
      setSelectedCollection(null)
    }
    toast.success(`Deleted "${collection?.name || 'collection'}"`)
  }

  const handleRemovePlace = async (collectionId, placeId, placeName) => {
    await removePlaceFromCollection(collectionId, placeId)
    toast.success(`Removed ${placeName || 'place'} from collection`)
  }

  // Paginated places
  const displayedPlaces = selectedCollection?.places.slice(0, placesDisplayLimit) || []
  const hasMorePlaces = selectedCollection && selectedCollection.places.length > placesDisplayLimit

  // Collection detail view
  if (selectedCollection) {
    return (
      <div className="collections-page">
        <header className="collections-header">
          <button className="collections-back-btn" onClick={() => {
            setSelectedCollection(null)
            setPlacesDisplayLimit(PAGE_SIZE)
          }}>
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
          <>
            <div className="collections-places-list">
              <AnimatePresence>
                {displayedPlaces.map((item, index) => (
                  <motion.div
                    key={item.placeId}
                    className="collections-place-item"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -100 }}
                    transition={{ delay: Math.min(index, 14) * 0.05 }}
                  >
                    <div className="collections-place-info">
                      <span className="collections-place-name">{item.placeName || item.placeId}</span>
                      {item.note && (
                        <span className="collections-place-note">{item.note}</span>
                      )}
                    </div>
                    <button
                      className="collections-remove-btn"
                      onClick={() => handleRemovePlace(selectedCollection.id, item.placeId, item.placeData?.name)}
                    >
                      <TrashIcon />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* Load More Button */}
            {hasMorePlaces && (
              <button
                className="collections-load-more"
                onClick={() => setPlacesDisplayLimit(prev => prev + PAGE_SIZE)}
              >
                Load More ({selectedCollection.places.length - placesDisplayLimit} remaining)
              </button>
            )}
          </>
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
        <div className="collections-title-row">
          <h1 className="collections-title">My Collections</h1>
          {!isPremium && (
            <Link
              to="/pricing"
              className={`collections-limit ${collections.length >= 3 ? 'full' : ''}`}
            >
              {collections.length}/3
            </Link>
          )}
        </div>
        <button
          className="collections-add-btn"
          onClick={() => {
            if (!isPremium && collections.length >= 3) {
              setShowUpgradePrompt(true)
              return
            }
            setShowCreateForm(true)
          }}
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
            onClick={() => {
              if (!isPremium && collections.length >= 3) {
                setShowUpgradePrompt(true)
                return
              }
              setShowCreateForm(true)
            }}
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
                onClick={() => {
                  setSelectedCollection(collection)
                  setPlacesDisplayLimit(PAGE_SIZE)
                }}
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
            onClick={() => {
              if (!isPremium && collections.length >= 3) {
                setShowUpgradePrompt(true)
                return
              }
              setShowCreateForm(true)
            }}
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

      {/* Upgrade prompt for collection limit */}
      <UpgradePrompt
        type="collections"
        isOpen={showUpgradePrompt}
        onClose={() => setShowUpgradePrompt(false)}
      />
    </div>
  )
}

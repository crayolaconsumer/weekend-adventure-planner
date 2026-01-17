import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import './Wishlist.css'

// Icons
const MapPinIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21,10c0,7-9,13-9,13S3,17,3,10a9,9,0,0,1,18,0Z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
)

const NavigationIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="3,11 22,2 13,21 11,13"/>
  </svg>
)

const TrashIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3,6 5,6 21,6"/>
    <path d="M19,6V20a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6M8,6V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6"/>
  </svg>
)

const HeartIcon = () => (
  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84,4.61a5.5,5.5,0,0,0-7.78,0L12,5.67,10.94,4.61a5.5,5.5,0,0,0-7.78,7.78l1.06,1.06L12,21.23l7.78-7.78,1.06-1.06a5.5,5.5,0,0,0,0-7.78Z"/>
  </svg>
)

// Placeholder images
const IMAGES = [
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&q=80',
  'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400&q=80',
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&q=80',
  'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400&q=80',
]

function getPlaceholderImage(id) {
  const index = Math.abs(id?.toString().split('').reduce((a, b) => a + b.charCodeAt(0), 0) || 0) % IMAGES.length
  return IMAGES[index]
}

// Helper to load wishlist from localStorage (lazy initialization)
function loadWishlistFromStorage() {
  const saved = localStorage.getItem('roam_wishlist')
  return saved ? JSON.parse(saved) : []
}

export default function Wishlist() {
  const navigate = useNavigate()
  // Use lazy initialization to load wishlist from localStorage
  const [wishlist, setWishlist] = useState(loadWishlistFromStorage)
  const [filter, setFilter] = useState('all')

  const removeFromWishlist = (placeId) => {
    const newWishlist = wishlist.filter(p => p.id !== placeId)
    setWishlist(newWishlist)
    localStorage.setItem('roam_wishlist', JSON.stringify(newWishlist))
  }

  const goToPlace = (place) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`
    window.open(url, '_blank')
  }

  const formatSavedDate = (timestamp) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  // Get unique categories from wishlist
  const categories = [...new Set(wishlist.map(p => p.category?.key).filter(Boolean))]

  // Filter wishlist
  const filteredWishlist = filter === 'all'
    ? wishlist
    : wishlist.filter(p => p.category?.key === filter)

  return (
    <div className="page wishlist-page">
      <header className="page-header">
        <h1 className="page-title">Wishlist</h1>
        <p className="wishlist-subtitle">
          {wishlist.length} {wishlist.length === 1 ? 'place' : 'places'} saved
        </p>
      </header>

      <div className="page-content">
        {wishlist.length > 0 ? (
          <>
            {/* Filters */}
            {categories.length > 1 && (
              <div className="wishlist-filters">
                <button
                  className={`chip ${filter === 'all' ? 'selected' : ''}`}
                  onClick={() => setFilter('all')}
                >
                  All
                </button>
                {categories.map(cat => {
                  const category = wishlist.find(p => p.category?.key === cat)?.category
                  return (
                    <button
                      key={cat}
                      className={`chip ${filter === cat ? 'selected' : ''}`}
                      onClick={() => setFilter(cat)}
                    >
                      {category?.icon} {category?.label}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Wishlist Items */}
            <div className="wishlist-grid">
              <AnimatePresence>
                {filteredWishlist.map((place, index) => (
                  <motion.div
                    key={place.id}
                    className="wishlist-card"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <div
                      className="wishlist-card-image"
                      style={{
                        backgroundImage: `url(${place.photo || place.image || getPlaceholderImage(place.id)})`
                      }}
                    >
                      <div className="wishlist-card-gradient" />
                      {place.category && (
                        <span className="wishlist-card-category">
                          {place.category.icon}
                        </span>
                      )}
                    </div>

                    <div className="wishlist-card-content">
                      <h3 className="wishlist-card-name">{place.name}</h3>

                      <div className="wishlist-card-meta">
                        {place.type && (
                          <span className="wishlist-card-type">
                            {place.type.replace(/_/g, ' ')}
                          </span>
                        )}
                        {place.distance && (
                          <span className="wishlist-card-distance">
                            <MapPinIcon />
                            {place.distance < 1
                              ? `${Math.round(place.distance * 1000)}m`
                              : `${place.distance.toFixed(1)}km`
                            }
                          </span>
                        )}
                      </div>

                      <span className="wishlist-card-saved">
                        Saved {formatSavedDate(place.savedAt)}
                      </span>

                      <div className="wishlist-card-actions">
                        <button
                          className="wishlist-card-btn go"
                          onClick={() => goToPlace(place)}
                        >
                          <NavigationIcon />
                          Go
                        </button>
                        <button
                          className="wishlist-card-btn remove"
                          onClick={() => removeFromWishlist(place.id)}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </>
        ) : (
          <div className="wishlist-empty">
            <div className="wishlist-empty-icon">
              <HeartIcon />
            </div>
            <h3>No saved places yet</h3>
            <p>Swipe right on places you want to visit later, and they'll appear here.</p>
            <button
              className="wishlist-empty-cta"
              onClick={() => navigate('/')}
            >
              Start Discovering
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { enrichPlace } from '../utils/apiClient'
import PlaceReviews from './PlaceReviews'
import SocialProof from './SocialProof'
import PlaceBadges from './PlaceBadges'
import ShareButton from './ShareButton'
import CollectionManager from './CollectionManager'
import { ContributionList } from './ContributionDisplay'
import { useContributions } from '../hooks/useContributions'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useFormatDistance } from '../contexts/DistanceContext'
import { openDirections, openExternalLink } from '../utils/navigation'
import './PlaceDetail.css'

// Icons
const CloseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const MapPinIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21,10c0,7-9,13-9,13S3,17,3,10a9,9,0,0,1,18,0Z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
)

const ClockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12,6 12,12 16,14"/>
  </svg>
)

const PhoneIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
  </svg>
)

const GlobeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
)

const NavigationIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="3,11 22,2 13,21 11,13"/>
  </svg>
)

const WikiIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12.09 13.119c-.936 1.932-2.217 4.548-2.853 5.728-.616 1.074-1.127.931-1.532.029-1.406-3.321-4.293-9.144-5.651-12.409-.251-.601-.441-.987-.619-1.139-.181-.15-.554-.24-1.122-.271C.103 5.033 0 4.982 0 4.898v-.455l.052-.045c.924-.005 5.401 0 5.401 0l.051.045v.434c0 .119-.075.176-.225.176l-.564.031c-.485.029-.727.164-.727.436 0 .135.053.33.166.601 1.082 2.646 4.818 10.521 4.818 10.521l.136.046 2.411-4.81-.482-1.067-1.658-3.264s-.318-.654-.428-.872c-.728-1.443-.712-1.518-1.447-1.617-.207-.023-.313-.05-.313-.149v-.468l.06-.045h4.292l.113.037v.451c0 .105-.076.15-.227.15l-.308.047c-.792.061-.661.381-.136 1.422l1.582 3.252 1.758-3.504c.293-.64.233-.801-.3-.852l-.29-.04c-.207-.03-.306-.068-.306-.179v-.418l.06-.045h3.704l.054.037v.477c0 .082-.089.137-.264.137-.599.053-1.023.17-1.277.653-.213.405-2.021 4.153-2.653 5.35l.127.045 4.829 9.146.125-.023 4.795-11.448c.166-.391.245-.71.245-.939 0-.345-.238-.555-.711-.626l-.474-.049c-.238-.022-.354-.075-.354-.174v-.435l.052-.045h5.09l.039.045v.416c0 .135-.089.194-.264.194-.915.078-1.352.332-1.766 1.169-.31.62-5.61 12.86-5.61 12.86-.403.939-.753 1.06-1.148.022-.623-1.578-2.525-5.096-3.376-6.879z"/>
  </svg>
)

const StarIcon = ({ filled }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
)

const WheelchairIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M9 12h6"/>
    <path d="M12 9v6"/>
  </svg>
)

const FolderPlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
    <line x1="12" y1="10" x2="12" y2="16"/>
    <line x1="9" y1="13" x2="15" y2="13"/>
  </svg>
)

// Category-specific placeholder images (same as SwipeCard)
const CATEGORY_IMAGES = {
  food: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=80',
  nature: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80',
  culture: 'https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=800&q=80',
  historic: 'https://images.unsplash.com/photo-1548013146-72479768bada?w=800&q=80',
  entertainment: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=800&q=80',
  nightlife: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=800&q=80',
  active: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&q=80',
  unique: 'https://images.unsplash.com/photo-1569701813229-33284b643e3c?w=800&q=80',
  shopping: 'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=800&q=80',
  default: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=800&q=80'
}

export default function PlaceDetail({ place, onClose, onGo }) {
  const [enrichedPlace, setEnrichedPlace] = useState(place)
  const [loading, setLoading] = useState(true)
  const [loadedSrc, setLoadedSrc] = useState(null)
  const [failedSrc, setFailedSrc] = useState(null)
  const [showCollectionManager, setShowCollectionManager] = useState(false)
  const { contributions, loading: contributionsLoading, refresh: refreshContributions } = useContributions(place?.id)
  const formatDistance = useFormatDistance()

  // Fetch contributions on mount
  useEffect(() => {
    if (place?.id) {
      refreshContributions()
    }
  }, [place?.id, refreshContributions])

  // Fetch enriched data when modal opens
  useEffect(() => {
    const fetchDetails = async () => {
      setLoading(true)
      try {
        const enriched = await enrichPlace(place)
        setEnrichedPlace({ ...place, ...enriched })
      } catch (error) {
        console.error('Failed to enrich place:', error)
      }
      setLoading(false)
    }

    fetchDetails()
  }, [place])

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  const category = enrichedPlace.category

  const extractImageUrl = (value) => {
    if (!value) return null
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const url = extractImageUrl(item)
        if (url) return url
      }
      return null
    }
    if (typeof value === 'object') {
      return extractImageUrl(value.url || value.source || value.src)
    }
    return null
  }

  const getPlaceholderImage = () => CATEGORY_IMAGES[category?.key] || CATEGORY_IMAGES.default

  const resolvedImageUrl =
    extractImageUrl(enrichedPlace.photo) ||
    extractImageUrl(enrichedPlace.image) ||
    getPlaceholderImage()

  const imageError = failedSrc === resolvedImageUrl
  const imageUrl = imageError ? getPlaceholderImage() : resolvedImageUrl
  const imageLoaded = loadedSrc === imageUrl

  const handleDirections = () => {
    openDirections(enrichedPlace.lat, enrichedPlace.lng, enrichedPlace.name)
    onGo?.(enrichedPlace)
  }

  const handleWebsite = () => {
    if (enrichedPlace.website) {
      openExternalLink(enrichedPlace.website)
    }
  }

  const handlePhone = () => {
    if (enrichedPlace.phone) {
      window.location.href = `tel:${enrichedPlace.phone}`
    }
  }

  const handleWikipedia = () => {
    if (enrichedPlace.wikipedia) {
      const [lang, title] = enrichedPlace.wikipedia.split(':')
      openExternalLink(`https://${lang}.wikipedia.org/wiki/${title}`)
    }
  }

  // Focus trap for accessibility
  const focusTrapRef = useFocusTrap(true)

  return (
    <>
      <AnimatePresence mode="wait">
        <motion.div
          className="place-detail-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          onClick={onClose}
        >
        <motion.div
          ref={focusTrapRef}
          className="place-detail-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="place-detail-title"
          initial={{ opacity: 0, y: '100%', scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{
            opacity: 0,
            y: '100%',
            scale: 0.95,
            transition: {
              type: 'spring',
              stiffness: 400,
              damping: 35,
              mass: 0.8
            }
          }}
          transition={{
            type: 'spring',
            stiffness: 300,
            damping: 30,
            mass: 0.8
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Hero Image */}
          <div className="place-detail-hero">
            {!imageLoaded && <div className="place-detail-image-placeholder" />}
            <motion.img
              src={imageUrl}
              alt={enrichedPlace.name}
              className={`place-detail-image ${imageLoaded ? 'loaded' : ''}`}
              onLoad={() => setLoadedSrc(imageUrl)}
              onError={() => {
                if (imageUrl === resolvedImageUrl) {
                  setFailedSrc(resolvedImageUrl)
                }
              }}
              initial={{ scale: 1.1 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
            <div className="place-detail-hero-gradient" />

            {/* Header buttons */}
            <div className="place-detail-header-buttons">
              <ShareButton place={enrichedPlace} variant="icon" />
              <button className="place-detail-close" onClick={onClose} aria-label="Close place details">
                <CloseIcon />
              </button>
            </div>

            {/* Category badge */}
            {category && (
              <motion.span
                className="place-detail-category"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
              >
                <span>{category.icon}</span>
                {category.label}
              </motion.span>
            )}
          </div>

          {/* Content */}
          <div className="place-detail-content">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <h1 id="place-detail-title" className="place-detail-name">{enrichedPlace.name}</h1>

              {/* Quick info pills */}
              <div className="place-detail-pills">
                {enrichedPlace.distance && (
                  <span className="place-detail-pill">
                    <MapPinIcon />
                    {formatDistance(enrichedPlace.distance, { withSuffix: true })}
                  </span>
                )}
                {enrichedPlace.isOpen !== null && (
                  <span className={`place-detail-pill ${enrichedPlace.isOpen ? 'open' : 'closed'}`}>
                    <ClockIcon />
                    {enrichedPlace.isOpen ? 'Open now' : 'Closed'}
                  </span>
                )}
                {enrichedPlace.rating && (
                  <span className="place-detail-pill rating">
                    <StarIcon filled />
                    {enrichedPlace.rating.toFixed(1)}
                  </span>
                )}
                {enrichedPlace.wheelchair === 'yes' && (
                  <span className="place-detail-pill accessible">
                    <WheelchairIcon />
                    Accessible
                  </span>
                )}
                <SocialProof placeId={place.id} variant="full" />
              </div>
              <PlaceBadges place={enrichedPlace} variant="full" maxVisible={4} />
            </motion.div>

            {/* Description */}
            <motion.div
              className="place-detail-section"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              {loading ? (
                <div className="place-detail-loading">
                  <div className="place-detail-loading-bar" />
                  <div className="place-detail-loading-bar short" />
                </div>
              ) : (
                <>
                  {enrichedPlace.description && (
                    <p className="place-detail-description">{enrichedPlace.description}</p>
                  )}
                  {!enrichedPlace.description && enrichedPlace.type && (
                    <p className="place-detail-type-info">
                      {enrichedPlace.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </p>
                  )}
                </>
              )}
            </motion.div>

            {/* Address */}
            {enrichedPlace.address && (
              <motion.div
                className="place-detail-section"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
              >
                <h3 className="place-detail-section-title">
                  <MapPinIcon />
                  Address
                </h3>
                <p className="place-detail-address">{enrichedPlace.address}</p>
              </motion.div>
            )}

            {/* Mini Map Preview */}
            {enrichedPlace.lat && enrichedPlace.lng && (
              <motion.div
                className="place-detail-section"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.27 }}
              >
                <div className="place-detail-map">
                  <iframe
                    title={`Map showing ${enrichedPlace.name}`}
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${enrichedPlace.lng - 0.008},${enrichedPlace.lat - 0.006},${enrichedPlace.lng + 0.008},${enrichedPlace.lat + 0.006}&layer=mapnik&marker=${enrichedPlace.lat},${enrichedPlace.lng}`}
                    className="place-detail-map-iframe"
                    loading="lazy"
                  />
                </div>
              </motion.div>
            )}

            {/* Opening Hours */}
            {enrichedPlace.openingHours && (
              <motion.div
                className="place-detail-section"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <h3 className="place-detail-section-title">
                  <ClockIcon />
                  Opening Hours
                </h3>
                <p className="place-detail-hours">{enrichedPlace.openingHours}</p>
              </motion.div>
            )}

            {/* Quick Actions */}
            <motion.div
              className="place-detail-actions"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
            >
              {enrichedPlace.phone && (
                <button className="place-detail-action-btn" onClick={handlePhone}>
                  <PhoneIcon />
                  <span>Call</span>
                </button>
              )}
              {enrichedPlace.website && (
                <button className="place-detail-action-btn" onClick={handleWebsite}>
                  <GlobeIcon />
                  <span>Website</span>
                </button>
              )}
              {enrichedPlace.wikipedia && (
                <button className="place-detail-action-btn" onClick={handleWikipedia}>
                  <WikiIcon />
                  <span>Wikipedia</span>
                </button>
              )}
              <button className="place-detail-action-btn" onClick={() => setShowCollectionManager(true)}>
                <FolderPlusIcon />
                <span>Save</span>
              </button>
            </motion.div>

            {/* User Review */}
            <PlaceReviews placeId={place.id} />

            {/* Community Tips */}
            {(contributions.length > 0 || contributionsLoading) && (
              <motion.div
                className="place-detail-section"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45 }}
              >
                <h3 className="place-detail-section-title">
                  <span style={{ marginRight: '4px' }}>💡</span>
                  Community Tips
                </h3>
                <ContributionList
                  contributions={contributions}
                  loading={contributionsLoading}
                  emptyMessage="No tips yet"
                />
              </motion.div>
            )}

            {/* Go Button */}
            <motion.button
              className="place-detail-go-btn"
              onClick={handleDirections}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <NavigationIcon />
              <span>Get Directions</span>
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
      </AnimatePresence>

      {/* Collection Manager Modal */}
      <CollectionManager
        isOpen={showCollectionManager}
        onClose={() => setShowCollectionManager(false)}
        place={enrichedPlace}
      />
    </>
  )
}

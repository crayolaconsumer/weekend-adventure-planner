import { useState } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { useDrag } from '@use-gesture/react'
import './SwipeCard.css'

// Category-specific placeholder images
const CATEGORY_IMAGES = {
  food: [
    'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=80', // Restaurant interior
    'https://images.unsplash.com/photo-1552566626-52f8b828add9?w=800&q=80', // British pub
    'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=800&q=80', // Cafe
    'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=800&q=80', // Bar
  ],
  nature: [
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80', // Rolling hills
    'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&q=80', // Forest path
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80', // Beach
    'https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=800&q=80', // English garden
  ],
  culture: [
    'https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=800&q=80', // Museum interior
    'https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=800&q=80', // Art gallery
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80', // Theatre
    'https://images.unsplash.com/photo-1594794312433-05a69a98b7a0?w=800&q=80', // Library
  ],
  historic: [
    'https://images.unsplash.com/photo-1548013146-72479768bada?w=800&q=80', // Castle
    'https://images.unsplash.com/photo-1590001155093-a3c66ab0c3ff?w=800&q=80', // Cathedral
    'https://images.unsplash.com/photo-1582034438067-64c2e2a95766?w=800&q=80', // Historic building
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80', // Ruins
  ],
  entertainment: [
    'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=800&q=80', // Cinema
    'https://images.unsplash.com/photo-1545315003-c5ad6226c272?w=800&q=80', // Bowling
    'https://images.unsplash.com/photo-1534423861386-85a16f5d13fd?w=800&q=80', // Arcade
    'https://images.unsplash.com/photo-1551620831-0175ea233a2e?w=800&q=80', // Theme park
  ],
  nightlife: [
    'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=800&q=80', // Bar
    'https://images.unsplash.com/photo-1566417713940-fe7c737a9ef2?w=800&q=80', // Nightclub
    'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=800&q=80', // Cocktail bar
    'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=800&q=80', // Drinks
  ],
  active: [
    'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&q=80', // Gym
    'https://images.unsplash.com/photo-1519311965067-36d3e5f33d39?w=800&q=80', // Pool
    'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&q=80', // Sports
    'https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?w=800&q=80', // Climbing
  ],
  unique: [
    'https://images.unsplash.com/photo-1569701813229-33284b643e3c?w=800&q=80', // Street art
    'https://images.unsplash.com/photo-1533929736458-ca588d08c8be?w=800&q=80', // London quirky
    'https://images.unsplash.com/photo-1509023464722-18d996393ca8?w=800&q=80', // Unique view
    'https://images.unsplash.com/photo-1594322436404-5a0526db4d13?w=800&q=80', // Hidden alley
  ],
  shopping: [
    'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=800&q=80', // Market
    'https://images.unsplash.com/photo-1528698827591-e19ccd7bc23d?w=800&q=80', // Bookshop
    'https://images.unsplash.com/photo-1513757378314-e46255f6ed16?w=800&q=80', // Vintage shop
    'https://images.unsplash.com/photo-1559454403-b8fb88521f11?w=800&q=80', // Antiques
  ],
  default: [
    'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=800&q=80', // UK cityscape
    'https://images.unsplash.com/photo-1486299267070-83823f5448dd?w=800&q=80', // British town
    'https://images.unsplash.com/photo-1520986606214-8b456906c813?w=800&q=80', // Countryside
    'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?w=800&q=80', // Quaint street
  ]
}

function getPlaceholderImage(placeId, categoryKey) {
  const images = CATEGORY_IMAGES[categoryKey] || CATEGORY_IMAGES.default
  const index = Math.abs(placeId?.toString().split('').reduce((a, b) => a + b.charCodeAt(0), 0) || 0) % images.length
  return images[index]
}

// Icons
const XIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const HeartIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M20.84,4.61a5.5,5.5,0,0,0-7.78,0L12,5.67,10.94,4.61a5.5,5.5,0,0,0-7.78,7.78l1.06,1.06L12,21.23l7.78-7.78,1.06-1.06a5.5,5.5,0,0,0,0-7.78Z"/>
  </svg>
)

const NavigationIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="3,11 22,2 13,21 11,13"/>
  </svg>
)

const ClockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12,6 12,12 16,14"/>
  </svg>
)

const MapPinIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21,10c0,7-9,13-9,13S3,17,3,10a9,9,0,0,1,18,0Z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
)

export default function SwipeCard({
  place,
  onSwipe,
  onExpand,
  isTop = false,
  style = {}
}) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [hasMoved, setHasMoved] = useState(false)

  const x = useMotionValue(0)
  const y = useMotionValue(0)

  // Transform values based on drag
  const rotate = useTransform(x, [-200, 200], [-15, 15])
  const likeOpacity = useTransform(x, [0, 100], [0, 1])
  const nopeOpacity = useTransform(x, [-100, 0], [1, 0])
  const goOpacity = useTransform(y, [-100, 0], [1, 0])

  // Drag gesture handler
  const bind = useDrag(
    ({ active, movement: [mx, my], direction: [dx, dy], velocity: [vx, vy] }) => {
      setIsDragging(active)

      if (active) {
        x.set(mx)
        y.set(my)
        // Track if user has moved significantly (to distinguish tap from drag)
        if (Math.abs(mx) > 10 || Math.abs(my) > 10) {
          setHasMoved(true)
        }
      } else {
        // Reset hasMoved after gesture ends
        setTimeout(() => setHasMoved(false), 50)
        // Check for swipe completion
        const swipeThreshold = 100
        const velocityThreshold = 0.5

        if (mx > swipeThreshold || (vx > velocityThreshold && dx > 0)) {
          // Swipe right - Like
          animate(x, 500, { duration: 0.3 })
          setTimeout(() => onSwipe?.('like'), 200)
        } else if (mx < -swipeThreshold || (vx > velocityThreshold && dx < 0)) {
          // Swipe left - Nope
          animate(x, -500, { duration: 0.3 })
          setTimeout(() => onSwipe?.('nope'), 200)
        } else if (my < -swipeThreshold || (vy > velocityThreshold && dy < 0)) {
          // Swipe up - Go now
          animate(y, -500, { duration: 0.3 })
          setTimeout(() => onSwipe?.('go'), 200)
        } else {
          // Spring back
          animate(x, 0, { type: 'spring', stiffness: 300, damping: 30 })
          animate(y, 0, { type: 'spring', stiffness: 300, damping: 30 })
        }
      }
    },
    { enabled: isTop }
  )

  const handleButtonClick = (action) => {
    if (action === 'like') {
      animate(x, 500, { duration: 0.3 })
    } else if (action === 'nope') {
      animate(x, -500, { duration: 0.3 })
    } else if (action === 'go') {
      animate(y, -500, { duration: 0.3 })
    }
    setTimeout(() => onSwipe?.(action), 200)
  }

  // Handle tap to expand (only if not dragging)
  const handleCardClick = (e) => {
    // Don't expand if clicking on buttons
    if (e.target.closest('.swipe-card-actions')) return
    // Don't expand if the user was dragging
    if (hasMoved) return
    // Trigger expand callback
    onExpand?.(place)
  }

  const category = place.category
  const imageUrl = place.photo || place.image || getPlaceholderImage(place.id, category?.key)

  const formatDistance = (km) => {
    if (!km) return null
    if (km < 1) return `${Math.round(km * 1000)}m`
    return `${km.toFixed(1)}km`
  }

  return (
    <motion.div
      className={`swipe-card ${isDragging ? 'dragging' : ''}`}
      style={{
        x,
        y,
        rotate,
        ...style
      }}
      {...(isTop ? bind() : {})}
      onClick={isTop ? handleCardClick : undefined}
    >
      {/* Background Image */}
      <div className="swipe-card-image-container">
        {!imageLoaded && <div className="swipe-card-image-placeholder" />}
        <img
          src={imageUrl}
          alt={place.name}
          className={`swipe-card-image ${imageLoaded ? 'loaded' : ''}`}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageLoaded(true)}
        />
      </div>

      {/* Gradient Overlay */}
      <div className="swipe-card-gradient" />

      {/* Action Indicators */}
      <motion.div
        className="swipe-card-indicator like"
        style={{ opacity: likeOpacity }}
      >
        SAVE
      </motion.div>
      <motion.div
        className="swipe-card-indicator nope"
        style={{ opacity: nopeOpacity }}
      >
        SKIP
      </motion.div>
      <motion.div
        className="swipe-card-indicator go"
        style={{ opacity: goOpacity }}
      >
        GO NOW
      </motion.div>

      {/* Content */}
      <div className="swipe-card-content">
        {category && (
          <span
            className="swipe-card-category"
            style={{ '--category-color': category.color }}
          >
            <span>{category.icon}</span>
            {category.label}
          </span>
        )}

        <h2 className="swipe-card-name">{place.name}</h2>

        <div className="swipe-card-meta">
          {place.distance && (
            <span className="swipe-card-meta-item">
              <MapPinIcon />
              {formatDistance(place.distance)}
            </span>
          )}
          {place.isOpen !== null && (
            <span className={`swipe-card-meta-item ${place.isOpen ? 'open' : 'closed'}`}>
              <ClockIcon />
              {place.isOpen ? 'Open' : 'Closed'}
            </span>
          )}
          {place.type && (
            <span className="swipe-card-meta-item type">
              {place.type.replace(/_/g, ' ')}
            </span>
          )}
        </div>

        {place.description && (
          <p className="swipe-card-description">"{place.description}"</p>
        )}

        {place.address && (
          <p className="swipe-card-address">{place.address}</p>
        )}
      </div>

      {/* Action Buttons */}
      {isTop && (
        <div className="swipe-card-actions">
          <button
            className="swipe-card-btn nope"
            onClick={() => handleButtonClick('nope')}
            aria-label="Skip this place"
          >
            <XIcon />
          </button>
          <button
            className="swipe-card-btn go"
            onClick={() => handleButtonClick('go')}
            aria-label="Go to this place now"
          >
            <NavigationIcon />
          </button>
          <button
            className="swipe-card-btn like"
            onClick={() => handleButtonClick('like')}
            aria-label="Save to wishlist"
          >
            <HeartIcon />
          </button>
        </div>
      )}
    </motion.div>
  )
}

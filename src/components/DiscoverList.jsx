/**
 * DiscoverList Component
 *
 * Compact scrollable list view for discovering places on desktop.
 * Provides quick scanning and keyboard navigation.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { GOOD_CATEGORIES } from '../utils/categories'
import { getOpeningState } from '../utils/openingHours'
import { useFormatDistance } from '../contexts/DistanceContext'
import './DiscoverList.css'

// Icons
const HeartIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.84,4.61a5.5,5.5,0,0,0-7.78,0L12,5.67,10.94,4.61a5.5,5.5,0,0,0-7.78,7.78l1.06,1.06L12,21.23l7.78-7.78,1.06-1.06a5.5,5.5,0,0,0,0-7.78Z"/>
  </svg>
)

const NavigationIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="3,11 22,2 13,21 11,13"/>
  </svg>
)

const MapPinIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21,10c0,7-9,13-9,13S3,17,3,10a9,9,0,0,1,18,0Z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
)

// List item component
function ListItem({ place, isSelected, onSelect, onSave, onGo, index, formatDistance }) {
  const itemRef = useRef(null)
  const category = place.category || GOOD_CATEGORIES[place.categoryKey]
  const openingState = getOpeningState(place.openingHours || place.opening_hours, place)

  // Scroll into view when selected
  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isSelected])

  return (
    <motion.div
      ref={itemRef}
      className={`discover-list-item ${isSelected ? 'selected' : ''}`}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03 }}
      onClick={() => onSelect(place)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(place)
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`${place.name}. ${formatDistance(place.distance) || ''}. Press Enter to view details.`}
    >
      {/* Thumbnail */}
      <div className="list-item-thumb">
        {place.photo ? (
          <img src={place.photo} alt="" loading="lazy" />
        ) : (
          <div className="list-item-thumb-placeholder">
            {/* Use generic icon to avoid duplicate when category badge shows icon */}
            <span>📍</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="list-item-content">
        <div className="list-item-header">
          {category && (
            <span className="list-item-category" style={{ '--cat-color': category.color }}>
              {category.icon} {category.label}
            </span>
          )}
          {openingState.state !== 'unknown' && (
            <span className={`list-item-status hours-${openingState.state}`}>
              {openingState.stateLabel}
            </span>
          )}
        </div>

        <h4 className="list-item-name">{place.name}</h4>

        <div className="list-item-meta">
          {place.distance && (
            <span className="list-item-distance">
              <MapPinIcon />
              {formatDistance(place.distance)}
            </span>
          )}
          {place.type && (
            <span className="list-item-type">
              {place.type.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="list-item-actions">
        <button
          className="list-item-btn save"
          onClick={(e) => {
            e.stopPropagation()
            onSave(place)
          }}
          aria-label="Save to wishlist"
        >
          <HeartIcon />
        </button>
        <button
          className="list-item-btn go"
          onClick={(e) => {
            e.stopPropagation()
            onGo(place)
          }}
          aria-label="Get directions"
        >
          <NavigationIcon />
        </button>
      </div>
    </motion.div>
  )
}

export default function DiscoverList({
  places,
  selectedPlace,
  onSelectPlace,
  onSavePlace,
  onGoPlace,
  onLoadMore,
  loading
}) {
  const [focusedIndex, setFocusedIndex] = useState(0)
  const listRef = useRef(null)
  const formatDistance = useFormatDistance()

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex(prev => Math.min(prev + 1, places.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && places[focusedIndex]) {
      onSelectPlace(places[focusedIndex])
    }
  }, [places, focusedIndex, onSelectPlace])

  // Infinite scroll
  const handleScroll = useCallback((e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target
    if (scrollHeight - scrollTop - clientHeight < 200 && !loading && onLoadMore) {
      onLoadMore()
    }
  }, [loading, onLoadMore])

  return (
    <motion.div
      className="discover-list-container"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="discover-list-header">
        <span className="discover-list-count">{places.length} places</span>
        <span className="discover-list-hint">↑↓ to navigate, Enter to view</span>
      </div>

      <div
        ref={listRef}
        className="discover-list"
        onKeyDown={handleKeyDown}
        onScroll={handleScroll}
        role="listbox"
        aria-label="Discovered places"
      >
        <AnimatePresence>
          {places.map((place, index) => (
            <ListItem
              key={place.id}
              place={place}
              isSelected={selectedPlace?.id === place.id || index === focusedIndex}
              onSelect={onSelectPlace}
              onSave={onSavePlace}
              onGo={onGoPlace}
              index={index}
              formatDistance={formatDistance}
            />
          ))}
        </AnimatePresence>

        {loading && (
          <div className="discover-list-loading">
            <div className="discover-list-spinner" />
            <span>Loading more...</span>
          </div>
        )}
      </div>
    </motion.div>
  )
}

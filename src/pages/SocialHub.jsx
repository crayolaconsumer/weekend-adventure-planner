/**
 * SocialHub Page
 *
 * The new Social tab that replaces the Profile tab in navigation.
 * Contains:
 * - Header with link to user's profile
 * - User search bar
 * - Tabs: "Near You" (location-aware feed) and "Find People"
 * - Location-aware friend activity feed
 * - User discovery section
 */

import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { useUserSearch, useDiscoverUsers } from '../hooks/useSocial'
import { useToast } from '../hooks/useToast'
import LocationAwareFeed from '../components/LocationAwareFeed'
import './SocialHub.css'

// Icons
const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)

const ClearIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const ChevronRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

const LocationPinIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
)

// User search bar component
function UserSearchBar() {
  const [query, setQuery] = useState('')
  const [showResults, setShowResults] = useState(false)
  const { results, loading, search, clearResults } = useUserSearch()

  useEffect(() => {
    const debounce = setTimeout(() => {
      if (query.trim().length >= 2) {
        search(query)
        setShowResults(true)
      } else {
        clearResults()
        setShowResults(false)
      }
    }, 300)

    return () => clearTimeout(debounce)
  }, [query, search, clearResults])

  const handleClear = () => {
    setQuery('')
    clearResults()
    setShowResults(false)
  }

  return (
    <div className="social-hub-search">
      <div className="social-hub-search-input-wrapper">
        <SearchIcon />
        <input
          type="text"
          placeholder="Search users..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 2 && setShowResults(true)}
          className="social-hub-search-input"
        />
        {query && (
          <button
            className="social-hub-search-clear"
            onClick={handleClear}
            aria-label="Clear search"
          >
            <ClearIcon />
          </button>
        )}
      </div>

      <AnimatePresence>
        {showResults && (results.length > 0 || loading) && (
          <motion.div
            className="social-hub-search-results"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {loading ? (
              <div className="social-hub-search-loading">Searching...</div>
            ) : (
              results.map(user => (
                <Link
                  key={user.id}
                  to={`/user/${user.username}`}
                  className="social-hub-search-result"
                  onClick={() => setShowResults(false)}
                >
                  <img
                    src={user.avatarUrl || '/default-avatar.png'}
                    alt=""
                    className="social-hub-search-result-avatar"
                  />
                  <div className="social-hub-search-result-info">
                    <span className="social-hub-search-result-name">
                      {user.displayName || user.username}
                    </span>
                    <span className="social-hub-search-result-username">
                      @{user.username}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Discover users section
function DiscoverUsers() {
  const { users, loading, error, refresh } = useDiscoverUsers()

  if (loading) {
    return (
      <div className="social-hub-discover">
        <h3 className="social-hub-discover-title">People Like You</h3>
        <div className="social-hub-discover-loading">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="social-hub-discover-skeleton" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="social-hub-discover-error">
        <p>Couldn't load suggestions</p>
        <button onClick={refresh}>Retry</button>
      </div>
    )
  }

  if (!users || users.length === 0) {
    return null
  }

  return (
    <div className="social-hub-discover">
      <h3 className="social-hub-discover-title">People Like You</h3>
      <div className="social-hub-discover-list">
        {users.slice(0, 5).map(user => (
          <Link
            key={user.id}
            to={`/user/${user.username}`}
            className="social-hub-discover-user"
          >
            <img
              src={user.avatarUrl || '/default-avatar.png'}
              alt=""
              className="social-hub-discover-user-avatar"
            />
            <div className="social-hub-discover-user-info">
              <span className="social-hub-discover-user-name">
                {user.displayName || user.username}
              </span>
              {user.sharedInterests && (
                <span className="social-hub-discover-user-match">
                  {user.sharedInterests} shared interests
                </span>
              )}
            </div>
            <ChevronRightIcon />
          </Link>
        ))}
      </div>
    </div>
  )
}

// Auth prompt for unauthenticated users
function AuthPrompt({ message }) {
  const openAuthModal = (mode) => {
    window.dispatchEvent(new CustomEvent('openAuthModal', { detail: { mode } }))
  }

  return (
    <div className="social-hub-auth-prompt">
      <div className="social-hub-auth-prompt-icon">👥</div>
      <h3>{message}</h3>
      <p>Connect with friends to see their discoveries and recommendations.</p>
      <div className="social-hub-auth-prompt-actions">
        <button
          className="social-hub-auth-prompt-btn primary"
          onClick={() => openAuthModal('login')}
        >
          Sign In
        </button>
        <button
          className="social-hub-auth-prompt-btn secondary"
          onClick={() => openAuthModal('register')}
        >
          Sign Up
        </button>
      </div>
    </div>
  )
}

export default function SocialHub({ location }) {
  const { isAuthenticated, user, loading: authLoading } = useAuth()
  const toast = useToast()
  const [activeTab, setActiveTab] = useState('feed')
  const locationToastShown = useRef(false)

  // Track location and its source to avoid race conditions
  // Priority: prop > geolocation > default
  const [userLocation, setUserLocation] = useState(location)
  const [locationSource, setLocationSource] = useState(location ? 'prop' : null)

  // Update location if prop changes - prop always takes priority
  useEffect(() => {
    if (location) {
      setUserLocation(location)
      setLocationSource('prop')
    }
  }, [location])

  // Request geolocation only if no location from prop and not already fetched
  useEffect(() => {
    // Don't request if we have a prop-based location or already have geolocation
    if (locationSource === 'prop' || locationSource === 'geo') {
      return
    }

    // Only request if we don't have any location yet
    if (!userLocation && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          // Only set if prop hasn't arrived in the meantime
          setUserLocation(prev => {
            // If prop arrived while waiting, don't overwrite
            if (prev && locationSource === 'prop') return prev
            setLocationSource('geo')
            return {
              lat: position.coords.latitude,
              lng: position.coords.longitude
            }
          })
        },
        () => {
          // Default to London only if no other location source
          setUserLocation(prev => {
            if (prev) return prev // Don't overwrite existing location
            setLocationSource('default')
            // Show toast to inform user about the fallback (only once)
            if (!locationToastShown.current) {
              locationToastShown.current = true
              toast.info("Couldn't get your location - showing London by default")
            }
            return { lat: 51.5074, lng: -0.1278 }
          })
        },
        { enableHighAccuracy: true, timeout: 10000 }
      )
    }
  }, [userLocation, locationSource, toast])

  if (authLoading) {
    return (
      <div className="page social-hub-page">
        <div className="social-hub-loading">
          <div className="social-hub-loading-spinner" />
          <span>Loading...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="page social-hub-page">
      {/* Header with profile link */}
      <header className="social-hub-header">
        <h1 className="social-hub-title">Social</h1>
        {isAuthenticated && user && (
          <Link to={`/user/${user.username}`} className="social-hub-profile-link">
            <img
              src={user.avatar_url || user.avatarUrl || '/default-avatar.png'}
              alt=""
              className="social-hub-profile-link-avatar"
            />
            <span className="social-hub-profile-link-text">My Profile</span>
            <ChevronRightIcon />
          </Link>
        )}
      </header>

      {/* User search */}
      <UserSearchBar />

      {/* Tabs */}
      <div className="social-hub-tabs" role="tablist">
        <button
          className={`social-hub-tab ${activeTab === 'feed' ? 'active' : ''}`}
          onClick={() => setActiveTab('feed')}
          role="tab"
          aria-selected={activeTab === 'feed'}
        >
          Near You
        </button>
        <button
          className={`social-hub-tab ${activeTab === 'discover' ? 'active' : ''}`}
          onClick={() => setActiveTab('discover')}
          role="tab"
          aria-selected={activeTab === 'discover'}
        >
          Find People
        </button>
      </div>

      {/* Location indicator - shown only on feed tab when we have a location */}
      {activeTab === 'feed' && locationSource && (
        <div className="social-hub-location-indicator">
          <LocationPinIcon />
          <span>
            {locationSource === 'geo' && 'Your location'}
            {locationSource === 'prop' && 'Your location'}
            {locationSource === 'default' && 'London (default)'}
          </span>
        </div>
      )}

      {/* Tab content */}
      <div className="social-hub-content">
        <AnimatePresence mode="wait">
          {activeTab === 'feed' ? (
            <motion.div
              key="feed"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {isAuthenticated ? (
                <LocationAwareFeed location={userLocation} />
              ) : (
                <AuthPrompt message="Sign in to see what friends recommend" />
              )}
            </motion.div>
          ) : (
            <motion.div
              key="discover"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
            >
              <DiscoverUsers />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

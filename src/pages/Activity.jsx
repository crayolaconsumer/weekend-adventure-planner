/**
 * Activity Page
 *
 * Shows activity feed from followed users, user discovery, and user search
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { useDiscoverUsers, useUserSearch } from '../hooks/useSocial'
import ActivityFeed from '../components/ActivityFeed'
import UserCard, { UserCardSkeleton } from '../components/UserCard'
import './Activity.css'

// Search icon
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

export default function Activity() {
  const { isAuthenticated, user } = useAuth()
  const [activeTab, setActiveTab] = useState('feed')
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const searchInputRef = useRef(null)
  const searchDebounceRef = useRef(null)
  const { users: discoveredUsers, loading: discoverLoading, refresh: refreshDiscover } = useDiscoverUsers()
  const { results: searchResults, loading: searchLoading, total: searchTotal, hasMore: searchHasMore, search, loadMore, clearResults } = useUserSearch()

  // Debounced search
  const handleSearchChange = useCallback((e) => {
    const value = e.target.value
    setSearchQuery(value)

    // Clear previous debounce
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }

    if (value.trim().length >= 2) {
      setIsSearching(true)
      searchDebounceRef.current = setTimeout(() => {
        search(value)
      }, 300)
    } else {
      setIsSearching(false)
      clearResults()
    }
  }, [search, clearResults])

  const handleClearSearch = useCallback(() => {
    setSearchQuery('')
    setIsSearching(false)
    clearResults()
    searchInputRef.current?.focus()
  }, [clearResults])

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [])

  return (
    <div className="page activity-page">
      <header className="page-header">
        <h1 className="page-title">Activity</h1>
      </header>

      {/* User Search */}
      <div className="activity-search">
        <div className="activity-search-input-wrapper">
          <SearchIcon />
          <input
            ref={searchInputRef}
            type="text"
            className="activity-search-input"
            placeholder="Search for users..."
            value={searchQuery}
            onChange={handleSearchChange}
            aria-label="Search users"
          />
          {searchQuery && (
            <button
              className="activity-search-clear"
              onClick={handleClearSearch}
              aria-label="Clear search"
            >
              <ClearIcon />
            </button>
          )}
        </div>
        {isSearching && searchTotal > 0 && (
          <span className="activity-search-count">{searchTotal} found</span>
        )}
      </div>

      {/* Search Results */}
      <AnimatePresence>
        {isSearching && (
          <motion.div
            className="activity-search-results"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            {searchLoading && searchResults.length === 0 ? (
              <div className="user-card-list">
                {[...Array(3)].map((_, i) => (
                  <UserCardSkeleton key={i} />
                ))}
              </div>
            ) : searchResults.length > 0 ? (
              <>
                <div className="user-card-list">
                  {searchResults.map((searchUser, index) => (
                    <motion.div
                      key={searchUser.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                    >
                      <UserCard user={searchUser} showStats />
                    </motion.div>
                  ))}
                </div>
                {searchHasMore && (
                  <button
                    className="activity-load-more"
                    onClick={() => loadMore(searchQuery)}
                    disabled={searchLoading}
                  >
                    {searchLoading ? 'Loading...' : 'Load more'}
                  </button>
                )}
              </>
            ) : searchQuery.length >= 2 ? (
              <div className="activity-search-empty">
                <p>No users found for "{searchQuery}"</p>
              </div>
            ) : (
              <div className="activity-search-hint">
                <p>Type at least 2 characters to search</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs - only show when not searching */}
      {!isSearching && (
        <div className="activity-tabs" role="tablist" aria-label="Activity sections">
          <button
            className={`activity-tab ${activeTab === 'feed' ? 'active' : ''}`}
            onClick={() => setActiveTab('feed')}
            role="tab"
            aria-selected={activeTab === 'feed'}
            aria-controls="activity-feed-panel"
            id="activity-tab-feed"
          >
            Feed
          </button>
          <button
            className={`activity-tab ${activeTab === 'discover' ? 'active' : ''}`}
            onClick={() => setActiveTab('discover')}
            role="tab"
            aria-selected={activeTab === 'discover'}
            aria-controls="activity-discover-panel"
            id="activity-tab-discover"
          >
            Discover
          </button>
        </div>
      )}

      {/* Tab Content - only show when not searching */}
      {!isSearching && (
        <div className="activity-content" role="tabpanel" id={activeTab === 'feed' ? 'activity-feed-panel' : 'activity-discover-panel'} aria-labelledby={activeTab === 'feed' ? 'activity-tab-feed' : 'activity-tab-discover'}>
          {activeTab === 'feed' ? (
            isAuthenticated ? (
              <ActivityFeed />
            ) : (
              <div className="activity-login-prompt">
                <div className="activity-login-prompt-icon">🔐</div>
                <h2>Sign in to see your feed</h2>
                <p>Follow other explorers to see their tips and discoveries here.</p>
                <Link to="/profile" className="activity-login-prompt-btn">
                  Sign In
                </Link>
              </div>
            )
          ) : (
            <DiscoverSection
              users={discoveredUsers}
              loading={discoverLoading}
              onRefresh={refreshDiscover}
              currentUserId={user?.id}
            />
          )}
        </div>
      )}
    </div>
  )
}

function DiscoverSection({ users, loading, onRefresh, currentUserId }) {
  if (loading && users.length === 0) {
    return (
      <div className="discover-section">
        <div className="discover-header">
          <h2>People to Follow</h2>
        </div>
        <div className="user-card-list">
          {[...Array(5)].map((_, i) => (
            <UserCardSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  }

  if (users.length === 0) {
    return (
      <div className="discover-section">
        <div className="discover-empty">
          <span className="discover-empty-icon">👥</span>
          <h3>No recommendations yet</h3>
          <p>Start exploring and saving places to get personalized recommendations!</p>
        </div>
      </div>
    )
  }

  return (
    <div className="discover-section">
      <div className="discover-header">
        <h2>People to Follow</h2>
        <button className="discover-refresh" onClick={onRefresh} disabled={loading}>
          {loading ? (
            <>
              <span className="discover-refresh-spinner" aria-hidden="true" />
              Refreshing...
            </>
          ) : 'Refresh'}
        </button>
      </div>

      <p className="discover-subtitle">
        Based on your saved places and interests
      </p>

      <motion.div
        className="user-card-list"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {users.filter(u => u.id !== currentUserId).map((user, index) => (
          <motion.div
            key={user.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <UserCard
              user={user}
              showStats
              showReason
            />
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}

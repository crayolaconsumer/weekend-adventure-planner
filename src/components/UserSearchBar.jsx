/**
 * UserSearchBar Component
 *
 * Reusable search bar for finding users
 * Can be placed on any page (Activity, Profile, etc.)
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUserSearch } from '../hooks/useSocial'
import UserCard, { UserCardSkeleton } from './UserCard'
import './UserSearchBar.css'

export default function UserSearchBar({
  placeholder = 'Search for users...',
  onResultClick,
  showInline = false,
  autoFocus = false
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)
  const searchInputRef = useRef(null)
  const searchDebounceRef = useRef(null)
  const containerRef = useRef(null)

  const {
    results: searchResults,
    loading: searchLoading,
    total: searchTotal,
    hasMore: searchHasMore,
    search,
    loadMore,
    clearResults
  } = useUserSearch()

  // Debounced search
  const handleSearchChange = useCallback((e) => {
    const value = e.target.value
    setSearchQuery(value)

    // Clear previous debounce
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }

    if (value.trim().length >= 2) {
      setIsExpanded(true)
      searchDebounceRef.current = setTimeout(() => {
        search(value)
      }, 300)
    } else {
      clearResults()
      if (value.trim().length === 0) {
        setIsExpanded(false)
      }
    }
  }, [search, clearResults])

  const handleClearSearch = useCallback(() => {
    setSearchQuery('')
    setIsExpanded(false)
    clearResults()
    searchInputRef.current?.focus()
  }, [clearResults])

  const handleResultClick = useCallback((user) => {
    if (onResultClick) {
      onResultClick(user)
    }
    handleClearSearch()
  }, [onResultClick, handleClearSearch])

  const handleFocus = useCallback(() => {
    if (searchQuery.trim().length >= 2) {
      setIsExpanded(true)
    }
  }, [searchQuery])

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsExpanded(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [])

  // Auto focus
  useEffect(() => {
    if (autoFocus && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [autoFocus])

  return (
    <div className={`user-search-bar ${showInline ? 'inline' : ''}`} ref={containerRef}>
      <div className="user-search-input-wrapper">
        <SearchIcon />
        <input
          ref={searchInputRef}
          type="text"
          className="user-search-input"
          placeholder={placeholder}
          value={searchQuery}
          onChange={handleSearchChange}
          onFocus={handleFocus}
          aria-label="Search users"
        />
        {searchQuery && (
          <button
            className="user-search-clear"
            onClick={handleClearSearch}
            aria-label="Clear search"
          >
            <ClearIcon />
          </button>
        )}
      </div>

      {isExpanded && searchQuery.trim().length >= 2 && searchTotal > 0 && (
        <span className="user-search-count">{searchTotal} found</span>
      )}

      {/* Search Results Dropdown */}
      <AnimatePresence>
        {isExpanded && searchQuery.trim().length >= 2 && (
          <motion.div
            className="user-search-results"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {searchLoading && searchResults.length === 0 ? (
              <div className="user-search-results-list">
                {[...Array(3)].map((_, i) => (
                  <UserCardSkeleton key={i} />
                ))}
              </div>
            ) : searchResults.length > 0 ? (
              <>
                <div className="user-search-results-list">
                  {searchResults.map((user, index) => (
                    <motion.div
                      key={user.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      onClick={() => handleResultClick(user)}
                    >
                      <UserCard
                        user={user}
                        showStats
                        compact={showInline}
                      />
                    </motion.div>
                  ))}
                </div>
                {searchHasMore && (
                  <button
                    className="user-search-load-more"
                    onClick={() => loadMore(searchQuery)}
                    disabled={searchLoading}
                  >
                    {searchLoading ? 'Loading...' : 'Load more'}
                  </button>
                )}
              </>
            ) : (
              <div className="user-search-empty">
                <p>No users found for "{searchQuery}"</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Icons
function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function ClearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

/**
 * ActivityFeed Component
 *
 * Shows rich activity from users you follow, including:
 * - Visits with place context and ratings
 * - Tips with helpful votes
 * - Photos with thumbnails
 */

import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useUnifiedActivityFeed } from '../hooks/useSocial'
import { useSavedPlaces } from '../hooks/useSavedPlaces'
import { useVisitedPlaces } from '../hooks/useVisitedPlaces'
import ActivityItem, { ActivityItemSkeleton } from './ActivityItem'
import './ActivityFeed.css'

// Filter options for activity types
const FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'visit', label: 'Visits' },
  { key: 'tip', label: 'Tips' },
  { key: 'photo', label: 'Photos' }
]

export default function ActivityFeed() {
  const [activeFilter, setActiveFilter] = useState('all')
  const { activities, loading, error, hasMore, loadMore, refresh } = useUnifiedActivityFeed(activeFilter === 'all' ? null : activeFilter)

  // Hooks for engagement features
  const { savePlace } = useSavedPlaces()
  const { visitedPlaces } = useVisitedPlaces()

  // Check if user has visited a place
  const hasVisited = useCallback((placeId) => {
    if (!placeId || !visitedPlaces) return false
    return visitedPlaces.some(vp => vp.placeId === placeId || vp.place_id === placeId)
  }, [visitedPlaces])

  // Handle saving a place from the feed
  const handleSavePlace = useCallback(async (place) => {
    if (place && place.id) {
      await savePlace({
        id: place.id,
        name: place.name,
        category: place.category ? { key: place.category } : null,
        imageUrl: place.imageUrl
      })
    }
  }, [savePlace])

  // Handle filter change
  const handleFilterChange = (filterKey) => {
    setActiveFilter(filterKey)
  }

  if (loading && activities.length === 0) {
    return (
      <div className="activity-feed">
        <div className="activity-feed-filters">
          {FILTER_OPTIONS.map(opt => (
            <button
              key={opt.key}
              className={`activity-feed-filter ${activeFilter === opt.key ? 'active' : ''}`}
              disabled
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="activity-feed-list">
          {[...Array(3)].map((_, i) => (
            <ActivityItemSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="activity-feed-error">
        <p>Failed to load activity feed</p>
        <button onClick={refresh}>Try again</button>
      </div>
    )
  }

  if (activities.length === 0 && activeFilter === 'all') {
    return (
      <div className="activity-feed-empty">
        <h3>No activity yet</h3>
        <p>Follow some users to see their activity here!</p>
        <p className="activity-feed-empty-hint">
          Check the Discover tab to find people with similar interests!
        </p>
      </div>
    )
  }

  return (
    <div className="activity-feed">
      {/* Filter tabs */}
      <div className="activity-feed-filters" role="tablist" aria-label="Activity type filter">
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.key}
            className={`activity-feed-filter ${activeFilter === opt.key ? 'active' : ''}`}
            onClick={() => handleFilterChange(opt.key)}
            role="tab"
            aria-selected={activeFilter === opt.key}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Activity list */}
      <div className="activity-feed-list">
        {activities.length === 0 ? (
          <div className="activity-feed-empty-filtered">
            <p>No {activeFilter} activities from people you follow</p>
            <button
              className="activity-feed-clear-filter"
              onClick={() => setActiveFilter('all')}
            >
              View all activity
            </button>
          </div>
        ) : (
          activities.map((activity, index) => (
            <ActivityItem
              key={activity.id}
              activity={activity}
              index={index}
              onSavePlace={handleSavePlace}
              hasVisited={hasVisited(activity.place?.id)}
            />
          ))
        )}
      </div>

      {hasMore && activities.length > 0 && (
        <button
          className="activity-feed-load-more"
          onClick={loadMore}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  )
}

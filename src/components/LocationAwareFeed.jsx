/**
 * LocationAwareFeed Component
 *
 * Shows friend activity prioritized by proximity:
 * - "Near you" section: places within 5km
 * - "Further away" section: places 5-50km
 * - "Everywhere" section: all other activity
 */

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useSavedPlaces } from '../hooks/useSavedPlaces'
import { useVisitedPlaces } from '../hooks/useVisitedPlaces'
import ActivityItem, { ActivityItemSkeleton } from './ActivityItem'
import './LocationAwareFeed.css'

// Get auth headers for API requests
function getAuthHeaders() {
  const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// Distance thresholds in meters
const NEAR_THRESHOLD = 5000     // 5km
const FURTHER_THRESHOLD = 50000 // 50km

export default function LocationAwareFeed({ location }) {
  const { isAuthenticated } = useAuth()
  const { savePlace } = useSavedPlaces()
  const { visitedPlaces } = useVisitedPlaces()

  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)

  // Fetch activities with location filtering
  const fetchActivities = useCallback(async (newOffset = 0, isRefresh = false) => {
    if (!isAuthenticated) return

    setLoading(true)
    if (isRefresh) {
      setError(null)
    }

    try {
      let url = `/api/activity/feed?limit=20&offset=${newOffset}`

      // Add location parameters if available
      if (location?.lat && location?.lng) {
        url += `&lat=${location.lat}&lng=${location.lng}&radius=50000`
      }

      const response = await fetch(url, {
        credentials: 'include',
        headers: getAuthHeaders()
      })

      if (!response.ok) {
        throw new Error('Failed to load activity feed')
      }

      const data = await response.json()

      if (newOffset === 0) {
        setActivities(data.activities || [])
      } else {
        setActivities(prev => [...prev, ...(data.activities || [])])
      }

      setHasMore(data.hasMore || false)
      setOffset(newOffset + (data.activities?.length || 0))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated, location])

  // Initial fetch
  useEffect(() => {
    fetchActivities(0, true)
  }, [fetchActivities])

  // Group activities by distance
  const groupedActivities = useMemo(() => {
    const near = []
    const further = []
    const everywhere = []

    activities.forEach(activity => {
      const distance = activity.distanceMeters

      if (distance !== null && distance !== undefined) {
        if (distance <= NEAR_THRESHOLD) {
          near.push(activity)
        } else if (distance <= FURTHER_THRESHOLD) {
          further.push(activity)
        } else {
          everywhere.push(activity)
        }
      } else {
        // No location data - put in everywhere
        everywhere.push(activity)
      }
    })

    return { near, further, everywhere }
  }, [activities])

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

  // Handle load more
  const handleLoadMore = () => {
    if (!loading && hasMore) {
      fetchActivities(offset, false)
    }
  }

  // Handle refresh
  const handleRefresh = () => {
    setOffset(0)
    fetchActivities(0, true)
  }

  if (loading && activities.length === 0) {
    return (
      <div className="location-aware-feed">
        <div className="location-aware-feed-section">
          <h3 className="location-aware-feed-section-title">Near You</h3>
          {[...Array(3)].map((_, i) => (
            <ActivityItemSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="location-aware-feed-error">
        <p>Failed to load activity feed</p>
        <button onClick={handleRefresh}>Try again</button>
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="location-aware-feed-empty">
        <h3>No nearby activity</h3>
        <p>Follow more users to see their recommendations near you!</p>
        <button
          className="location-aware-feed-empty-action"
          onClick={handleRefresh}
        >
          Refresh
        </button>
      </div>
    )
  }

  const hasNear = groupedActivities.near.length > 0
  const hasFurther = groupedActivities.further.length > 0
  const hasEverywhere = groupedActivities.everywhere.length > 0

  return (
    <div className="location-aware-feed">
      {/* Near You section */}
      {hasNear && (
        <section className="location-aware-feed-section">
          <h3 className="location-aware-feed-section-title">Near You</h3>
          {groupedActivities.near.map((activity, index) => (
            <ActivityItem
              key={activity.id}
              activity={activity}
              index={index}
              onSavePlace={handleSavePlace}
              hasVisited={hasVisited(activity.place?.id)}
            />
          ))}
        </section>
      )}

      {/* Further Away section */}
      {hasFurther && (
        <section className="location-aware-feed-section">
          <h3 className="location-aware-feed-section-title">Further Away</h3>
          {groupedActivities.further.map((activity, index) => (
            <ActivityItem
              key={activity.id}
              activity={activity}
              index={index}
              onSavePlace={handleSavePlace}
              hasVisited={hasVisited(activity.place?.id)}
            />
          ))}
        </section>
      )}

      {/* Everywhere section */}
      {hasEverywhere && (
        <section className="location-aware-feed-section">
          <h3 className="location-aware-feed-section-title">
            {hasNear || hasFurther ? 'Everywhere Else' : 'Recent Activity'}
          </h3>
          {groupedActivities.everywhere.map((activity, index) => (
            <ActivityItem
              key={activity.id}
              activity={activity}
              index={index}
              onSavePlace={handleSavePlace}
              hasVisited={hasVisited(activity.place?.id)}
            />
          ))}
        </section>
      )}

      {/* Load more */}
      {hasMore && (
        <button
          className="location-aware-feed-load-more"
          onClick={handleLoadMore}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  )
}

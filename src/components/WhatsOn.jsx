/**
 * What's On Component
 *
 * Shows local events from Eventbrite in a horizontal scrollable list.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import EventCard from './EventCard'
import { fetchEvents, getTodayEvents, getWeekendEvents, getFreeEvents } from '../utils/eventbriteApi'
import './WhatsOn.css'

// Filter options
const FILTERS = [
  { id: 'all', label: 'All Events' },
  { id: 'today', label: 'Today' },
  { id: 'weekend', label: 'This Weekend' },
  { id: 'free', label: 'Free' }
]

// Icons
const CalendarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
)

const ChevronRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
)

export default function WhatsOn({ userLocation, onViewAll }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState('all')
  const [error, setError] = useState(null)

  // Fetch events when location changes
  useEffect(() => {
    async function loadEvents() {
      if (!userLocation?.lat || !userLocation?.lng) {
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      try {
        const fetchedEvents = await fetchEvents(userLocation.lat, userLocation.lng, 20)
        setEvents(fetchedEvents)
      } catch (err) {
        console.error('Failed to load events:', err)
        setError('Could not load events')
      } finally {
        setLoading(false)
      }
    }

    loadEvents()
  }, [userLocation?.lat, userLocation?.lng])

  // Filter events based on active filter
  const filteredEvents = (() => {
    switch (activeFilter) {
      case 'today':
        return getTodayEvents(events)
      case 'weekend':
        return getWeekendEvents(events)
      case 'free':
        return getFreeEvents(events)
      default:
        return events
    }
  })()

  // Don't render if no location or no events available
  // Note: Eventbrite's public search API was deprecated in 2023
  // Events will only show if using a valid Eventbrite Destination API integration
  if (!userLocation?.lat || (!loading && events.length === 0)) {
    return null
  }

  return (
    <section className="whats-on">
      <div className="whats-on-header">
        <div className="whats-on-title-row">
          <CalendarIcon />
          <h3 className="whats-on-title">What&apos;s On</h3>
        </div>
        {onViewAll && events.length > 0 && (
          <button className="whats-on-view-all" onClick={onViewAll}>
            View All
            <ChevronRightIcon />
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="whats-on-filters">
        {FILTERS.map(filter => (
          <button
            key={filter.id}
            className={`whats-on-filter ${activeFilter === filter.id ? 'active' : ''}`}
            onClick={() => setActiveFilter(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Events list */}
      <div className="whats-on-content">
        {loading ? (
          <div className="whats-on-loading">
            <div className="whats-on-loading-card" />
            <div className="whats-on-loading-card" />
            <div className="whats-on-loading-card" />
          </div>
        ) : error ? (
          <div className="whats-on-error">
            <p>{error}</p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="whats-on-empty">
            <p>No events match this filter</p>
          </div>
        ) : (
          <div className="whats-on-scroll">
            <AnimatePresence mode="popLayout">
              {filteredEvents.slice(0, 10).map((event, index) => (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <EventCard event={event} variant="compact" />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Eventbrite attribution */}
      {events.length > 0 && (
        <p className="whats-on-attribution">
          Events powered by Eventbrite
        </p>
      )}
    </section>
  )
}

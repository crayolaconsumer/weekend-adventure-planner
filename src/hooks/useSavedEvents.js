/**
 * useSavedEvents Hook
 *
 * Unified interface for saved events regardless of auth state.
 * - Anonymous users: localStorage
 * - Logged-in users: API (MySQL)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'

const STORAGE_KEY = 'roam_saved_events'

function getAuthToken() {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

/**
 * Parse date strings back to Date objects after JSON deserialization
 */
function parseEventDates(events) {
  if (!Array.isArray(events)) return []
  return events.map(event => {
    if (!event.datetime) return event
    return {
      ...event,
      datetime: {
        ...event.datetime,
        start: event.datetime.start ? new Date(event.datetime.start) : null,
        end: event.datetime.end ? new Date(event.datetime.end) : null
      }
    }
  })
}

export function useSavedEvents() {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const loadedRef = useRef(false)

  const loadEvents = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      if (isAuthenticated) {
        const token = getAuthToken()
        const response = await fetch('/api/events/saved', {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        })

        if (!response.ok) {
          throw new Error('Failed to load saved events')
        }

        const data = await response.json()
        setEvents(parseEventDates(data.events || []))
      } else {
        const saved = localStorage.getItem(STORAGE_KEY)
        setEvents(saved ? parseEventDates(JSON.parse(saved)) : [])
      }
    } catch (err) {
      console.error('Error loading saved events:', err)
      // Fall back to localStorage
      const saved = localStorage.getItem(STORAGE_KEY)
      setEvents(saved ? parseEventDates(JSON.parse(saved)) : [])
    } finally {
      setLoading(false)
      loadedRef.current = true
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (authLoading) return
    loadEvents()
  }, [isAuthenticated, authLoading, loadEvents])

  const saveEvent = useCallback(async (event) => {
    if (!event || !event.id) return false

    const eventWithTimestamp = { ...event, savedAt: Date.now() }

    // Optimistic update
    setEvents(prev => {
      if (prev.some(e => e.id === event.id)) return prev
      return [eventWithTimestamp, ...prev]
    })

    if (isAuthenticated) {
      try {
        const token = getAuthToken()
        const response = await fetch('/api/events/saved', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          credentials: 'include',
          body: JSON.stringify({ event: eventWithTimestamp })
        })

        if (!response.ok) {
          throw new Error('Failed to save event')
        }
        return true
      } catch (err) {
        console.error('Error saving event to API:', err)
        // Revert optimistic update, save to localStorage
        setEvents(prev => prev.filter(e => e.id !== event.id))
        const saved = localStorage.getItem(STORAGE_KEY)
        const current = saved ? JSON.parse(saved) : []
        if (!current.some(e => e.id === event.id)) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify([eventWithTimestamp, ...current]))
        }
        return false
      }
    } else {
      const saved = localStorage.getItem(STORAGE_KEY)
      const current = saved ? JSON.parse(saved) : []
      if (!current.some(e => e.id === event.id)) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([eventWithTimestamp, ...current]))
      }
      return true
    }
  }, [isAuthenticated])

  const unsaveEvent = useCallback(async (eventId) => {
    // Optimistic update
    setEvents(prev => prev.filter(e => e.id !== eventId))

    if (isAuthenticated) {
      try {
        const token = getAuthToken()
        const response = await fetch(`/api/events/saved?eventId=${encodeURIComponent(eventId)}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        })

        if (!response.ok) {
          throw new Error('Failed to unsave event')
        }
        return true
      } catch (err) {
        console.error('Error unsaving event:', err)
        // Fall back to localStorage
        const saved = localStorage.getItem(STORAGE_KEY)
        const current = saved ? JSON.parse(saved) : []
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current.filter(e => e.id !== eventId)))
        return false
      }
    } else {
      const saved = localStorage.getItem(STORAGE_KEY)
      const current = saved ? JSON.parse(saved) : []
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current.filter(e => e.id !== eventId)))
      return true
    }
  }, [isAuthenticated])

  const isEventSaved = useCallback((eventId) => {
    return events.some(e => e.id === eventId)
  }, [events])

  const toggleSaveEvent = useCallback(async (event) => {
    if (isEventSaved(event.id)) {
      await unsaveEvent(event.id)
      return false
    } else {
      await saveEvent(event)
      return true
    }
  }, [isEventSaved, unsaveEvent, saveEvent])

  return {
    events,
    loading: loading || authLoading,
    error,
    saveEvent,
    unsaveEvent,
    isEventSaved,
    toggleSaveEvent,
    refresh: loadEvents
  }
}

export default useSavedEvents

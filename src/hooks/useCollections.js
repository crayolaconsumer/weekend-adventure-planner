/**
 * useCollections Hook
 *
 * Unified interface for collections regardless of auth state.
 * - Anonymous users: localStorage
 * - Logged-in users: API (MySQL)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'

const STORAGE_KEY = 'roam_collections'

function getAuthToken() {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

// Temp ID prefix for identifying local/offline-created collections
const TEMP_ID_PREFIX = 'temp_col_'

function generateLocalId() {
  return `col_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

function generateTempId() {
  return `${TEMP_ID_PREFIX}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

function isTempId(id) {
  return typeof id === 'string' && id.startsWith(TEMP_ID_PREFIX)
}

export function useCollections() {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [collections, setCollections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // M14: AbortController ref for request cancellation
  const abortControllerRef = useRef(null)

  const loadCollections = useCallback(async () => {
    // M14: Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    setLoading(true)
    setError(null)

    try {
      if (isAuthenticated) {
        const token = getAuthToken()
        const response = await fetch('/api/collections', {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          signal: abortControllerRef.current.signal
        })

        if (!response.ok) {
          throw new Error('Failed to load collections')
        }

        const data = await response.json()
        setCollections(data.collections || [])
      } else {
        const saved = localStorage.getItem(STORAGE_KEY)
        setCollections(saved ? JSON.parse(saved) : [])
      }
    } catch (err) {
      // M14: Ignore abort errors
      if (err.name === 'AbortError') return
      console.error('Error loading collections:', err)
      const saved = localStorage.getItem(STORAGE_KEY)
      setCollections(saved ? JSON.parse(saved) : [])
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (authLoading) return
    loadCollections()

    // M14: Cleanup - cancel request on unmount
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [isAuthenticated, authLoading, loadCollections])

  const createCollection = useCallback(async (data) => {
    // Use temp ID for authenticated users (will be replaced by server ID)
    // Use local ID for anonymous users (persists in localStorage)
    const tempId = isAuthenticated ? generateTempId() : generateLocalId()

    const newCollection = {
      id: tempId,
      name: data.name || 'New Collection',
      description: data.description || '',
      emoji: data.emoji || '📍',
      visibility: data.visibility || 'private',
      places: [],
      placeCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    if (isAuthenticated) {
      // Optimistic update: add collection with temp ID immediately
      setCollections(prev => [newCollection, ...prev])

      try {
        const token = getAuthToken()
        const response = await fetch('/api/collections', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          credentials: 'include',
          body: JSON.stringify(data)
        })

        if (!response.ok) {
          throw new Error('Failed to create collection')
        }

        const result = await response.json()
        const created = result.collection

        // Replace temp ID with server-assigned real ID
        setCollections(prev => prev.map(c =>
          c.id === tempId ? { ...created } : c
        ))
        return created
      } catch (err) {
        console.error('Error creating collection:', err)
        // On error, keep the temp collection but also save to localStorage as fallback
        // Update the temp collection to use a local ID for localStorage persistence
        const localCollection = { ...newCollection, id: generateLocalId() }
        setCollections(prev => prev.map(c =>
          c.id === tempId ? localCollection : c
        ))
        const saved = localStorage.getItem(STORAGE_KEY)
        const current = saved ? JSON.parse(saved) : []
        localStorage.setItem(STORAGE_KEY, JSON.stringify([localCollection, ...current]))
        return localCollection
      }
    } else {
      setCollections(prev => [newCollection, ...prev])
      const saved = localStorage.getItem(STORAGE_KEY)
      const current = saved ? JSON.parse(saved) : []
      localStorage.setItem(STORAGE_KEY, JSON.stringify([newCollection, ...current]))
      return newCollection
    }
  }, [isAuthenticated])

  const updateCollection = useCallback(async (collectionId, updates) => {
    // M15: Store original value for rollback
    let originalCollection = null
    setCollections(prev => {
      originalCollection = prev.find(c => c.id === collectionId)
      return prev.map(c =>
        c.id === collectionId ? { ...c, ...updates, updatedAt: Date.now() } : c
      )
    })

    if (isAuthenticated) {
      try {
        const token = getAuthToken()
        const response = await fetch(`/api/collections/${collectionId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          credentials: 'include',
          body: JSON.stringify(updates)
        })

        if (!response.ok) {
          throw new Error('Failed to update collection')
        }
        return true
      } catch (err) {
        console.error('Error updating collection:', err)
        // M15: Rollback to original state on error
        if (originalCollection) {
          setCollections(prev => prev.map(c =>
            c.id === collectionId ? originalCollection : c
          ))
        }
        // Also update localStorage as fallback
        const saved = localStorage.getItem(STORAGE_KEY)
        const current = saved ? JSON.parse(saved) : []
        const updated = current.map(c =>
          c.id === collectionId ? { ...c, ...updates, updatedAt: Date.now() } : c
        )
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
        return false
      }
    } else {
      const saved = localStorage.getItem(STORAGE_KEY)
      const current = saved ? JSON.parse(saved) : []
      const updated = current.map(c =>
        c.id === collectionId ? { ...c, ...updates, updatedAt: Date.now() } : c
      )
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return true
    }
  }, [isAuthenticated])

  const deleteCollection = useCallback(async (collectionId) => {
    // M15: Store original collection for rollback
    let deletedCollection = null
    let originalIndex = -1
    setCollections(prev => {
      originalIndex = prev.findIndex(c => c.id === collectionId)
      deletedCollection = prev[originalIndex]
      return prev.filter(c => c.id !== collectionId)
    })

    if (isAuthenticated) {
      try {
        const token = getAuthToken()
        const response = await fetch(`/api/collections/${collectionId}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        })

        if (!response.ok) {
          throw new Error('Failed to delete collection')
        }
        return true
      } catch (err) {
        console.error('Error deleting collection:', err)
        // M15: Rollback - restore deleted collection
        if (deletedCollection) {
          setCollections(prev => {
            const newCollections = [...prev]
            newCollections.splice(originalIndex, 0, deletedCollection)
            return newCollections
          })
        }
        return false
      }
    } else {
      const saved = localStorage.getItem(STORAGE_KEY)
      const current = saved ? JSON.parse(saved) : []
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current.filter(c => c.id !== collectionId)))
      return true
    }
  }, [isAuthenticated])

  const addPlaceToCollection = useCallback(async (collectionId, placeId, placeData = null, note = null) => {
    // Optimistic update
    setCollections(prev => prev.map(c => {
      if (c.id !== collectionId) return c
      if (c.places?.some(p => p.placeId === placeId)) return c
      return {
        ...c,
        places: [...(c.places || []), { placeId, placeData, note, addedAt: Date.now() }],
        placeCount: (c.placeCount || 0) + 1,
        updatedAt: Date.now()
      }
    }))

    if (isAuthenticated) {
      try {
        const token = getAuthToken()
        const response = await fetch(`/api/collections/${collectionId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          credentials: 'include',
          body: JSON.stringify({ placeId, placeData, note })
        })

        if (!response.ok) {
          throw new Error('Failed to add place to collection')
        }
        return true
      } catch (err) {
        console.error('Error adding place to collection:', err)
        // Update localStorage
        const saved = localStorage.getItem(STORAGE_KEY)
        const current = saved ? JSON.parse(saved) : []
        const updated = current.map(c => {
          if (c.id !== collectionId) return c
          if (c.places?.some(p => p.placeId === placeId)) return c
          return {
            ...c,
            places: [...(c.places || []), { placeId, placeData, note, addedAt: Date.now() }],
            updatedAt: Date.now()
          }
        })
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
        return false
      }
    } else {
      const saved = localStorage.getItem(STORAGE_KEY)
      const current = saved ? JSON.parse(saved) : []
      const updated = current.map(c => {
        if (c.id !== collectionId) return c
        if (c.places?.some(p => p.placeId === placeId)) return c
        return {
          ...c,
          places: [...(c.places || []), { placeId, placeData, note, addedAt: Date.now() }],
          updatedAt: Date.now()
        }
      })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return true
    }
  }, [isAuthenticated])

  const removePlaceFromCollection = useCallback(async (collectionId, placeId) => {
    // Optimistic update
    setCollections(prev => prev.map(c => {
      if (c.id !== collectionId) return c
      return {
        ...c,
        places: (c.places || []).filter(p => p.placeId !== placeId),
        placeCount: Math.max(0, (c.placeCount || 0) - 1),
        updatedAt: Date.now()
      }
    }))

    if (isAuthenticated) {
      try {
        const token = getAuthToken()
        const response = await fetch(`/api/collections/${collectionId}?placeId=${encodeURIComponent(placeId)}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        })

        if (!response.ok) {
          throw new Error('Failed to remove place from collection')
        }
        return true
      } catch (err) {
        console.error('Error removing place from collection:', err)
        const saved = localStorage.getItem(STORAGE_KEY)
        const current = saved ? JSON.parse(saved) : []
        const updated = current.map(c => {
          if (c.id !== collectionId) return c
          return {
            ...c,
            places: (c.places || []).filter(p => p.placeId !== placeId),
            updatedAt: Date.now()
          }
        })
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
        return false
      }
    } else {
      const saved = localStorage.getItem(STORAGE_KEY)
      const current = saved ? JSON.parse(saved) : []
      const updated = current.map(c => {
        if (c.id !== collectionId) return c
        return {
          ...c,
          places: (c.places || []).filter(p => p.placeId !== placeId),
          updatedAt: Date.now()
        }
      })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return true
    }
  }, [isAuthenticated])

  const getCollectionsForPlace = useCallback((placeId) => {
    return collections.filter(c => c.places?.some(p => p.placeId === placeId))
  }, [collections])

  const isPlaceInAnyCollection = useCallback((placeId) => {
    return collections.some(c => c.places?.some(p => p.placeId === placeId))
  }, [collections])

  return {
    collections,
    loading: loading || authLoading,
    error,
    createCollection,
    updateCollection,
    deleteCollection,
    addPlaceToCollection,
    removePlaceFromCollection,
    getCollectionsForPlace,
    isPlaceInAnyCollection,
    refresh: loadCollections
  }
}

export default useCollections

// Export utility for checking temp IDs (useful for UI indicators)
export { isTempId, TEMP_ID_PREFIX }

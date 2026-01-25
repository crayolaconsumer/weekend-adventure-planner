/**
 * Place Page
 *
 * Standalone page for viewing place details via shared links.
 * Route: /place/:id
 */

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { enrichPlace, fetchPlaceById } from '../utils/apiClient'
import PlaceDetail from '../components/PlaceDetail'
import LoadingState from '../components/LoadingState'
import { useSEO } from '../hooks/useSEO'
import { useVisitedPlaces } from '../hooks/useVisitedPlaces'
import './Place.css'

export default function Place() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [place, setPlace] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const { markVisited } = useVisitedPlaces()

  // Dynamic SEO for place pages
  useSEO({
    title: place?.name || 'Place Details',
    description: place?.description || (place?.name ? `Discover ${place.name} on ROAM` : 'View place details on ROAM'),
    image: place?.photo,
    url: `https://go-roam.uk/place/${id}`
  })

  useEffect(() => {
    const loadPlace = async () => {
      if (!id) {
        setError('No place ID provided')
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      try {
        // First try to get place from localStorage (if user has it saved)
        const savedPlaces = JSON.parse(localStorage.getItem('roam_wishlist') || '[]')
        let foundPlace = savedPlaces.find(p => p.id === id || p.id === parseInt(id, 10))

        // If not in localStorage, try fetching from API
        if (!foundPlace) {
          foundPlace = await fetchPlaceById(id)
        }

        if (!foundPlace) {
          setError('Place not found')
          setLoading(false)
          return
        }

        // Enrich the place with additional details
        const enriched = await enrichPlace(foundPlace)
        setPlace({ ...foundPlace, ...enriched })
      } catch (err) {
        console.error('Failed to load place:', err)
        setError('Failed to load place details')
      } finally {
        setLoading(false)
      }
    }

    loadPlace()
  }, [id])

  const handleClose = () => {
    // Navigate back or to discover page
    if (window.history.length > 2) {
      navigate(-1)
    } else {
      navigate('/')
    }
  }

  const handleGo = (place) => {
    // Mark as visited and open directions in Google Maps
    markVisited(place)
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`
    window.open(mapsUrl, '_blank')
  }

  if (loading) {
    return (
      <div className="place-page">
        <LoadingState variant="spinner" message="Loading place details..." size="large" />
      </div>
    )
  }

  if (error || !place) {
    return (
      <div className="place-page">
        <motion.div
          className="place-page-error"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <span className="place-page-error-icon">🗺️</span>
          <h2>{error || 'Place not found'}</h2>
          <p>This place may have been removed or the link is incorrect.</p>
          <button className="place-page-error-btn" onClick={() => navigate('/')}>
            Discover Places
          </button>
        </motion.div>
      </div>
    )
  }

  return (
    <PlaceDetail
      place={place}
      onClose={handleClose}
      onGo={handleGo}
    />
  )
}

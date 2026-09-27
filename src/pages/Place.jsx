/**
 * Place Page
 *
 * Standalone page for viewing place details via shared links.
 * Route: /place/:id
 */

import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { enrichPlace, fetchPlaceById } from '../utils/apiClient'
import PlaceDetail from '../components/PlaceDetail'
import GetAppCard from '../components/GetAppCard'
import { isNative } from '../utils/nativeBridge'
import LoadingState from '../components/LoadingState'
import { useSEO } from '../hooks/useSEO'
import { useVisitedPlaces } from '../hooks/useVisitedPlaces'
import { getCategoryForType } from '../utils/categories'
import './Place.css'

// Compass + wordmark lockup, the same header as the town pages. Links back
// into the app so a visitor from a shared link has somewhere to go.
function PlacePageHeader() {
  return (
    <header className="place-page-header">
      <Link to="/" className="place-page-brand" aria-label="ROAM home">
        <img src="/icons/icon.svg" alt="" width="34" height="34" />
        <span>ROAM</span>
      </Link>
      <Link to="/" className="btn btn-secondary place-page-header-cta">Discover places</Link>
    </header>
  )
}

export default function Place() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [place, setPlace] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const { markVisited } = useVisitedPlaces()

  // Dynamic SEO for place pages
  useSEO({
    title: place?.name || 'Place details',
    description: place?.description || (place?.name ? `Discover ${place.name} on ROAM` : 'View place details on ROAM'),
    image: place?.photo,
    url: `https://www.go-roam.uk/place/${id}`
  })

  useEffect(() => {
    const loadPlace = async () => {
      if (!id) {
        setError({ type: 'not_found', message: 'No place ID provided' })
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
          setError({ type: 'not_found', message: 'Place not found' })
          setLoading(false)
          return
        }

        // Enrich the place with additional details
        const enriched = await enrichPlace(foundPlace)
        const merged = { ...foundPlace, ...enriched }
        // Places fetched by id carry only the OSM type; derive the category
        // so the page shows its badge and branded image fallback.
        setPlace({ ...merged, category: merged.category || getCategoryForType(merged.type) })
      } catch (err) {
        console.error('Failed to load place:', err)
        // Set specific error messages based on error type
        if (err.message?.includes('404') || err.status === 404) {
          setError({ type: 'not_found', message: 'Place not found' })
        } else if (err.message?.includes('network') || err.name === 'TypeError' || !navigator.onLine) {
          setError({ type: 'network', message: 'Network error' })
        } else if (err.status === 429) {
          setError({ type: 'rate_limit', message: 'Too many requests' })
        } else {
          setError({ type: 'unknown', message: 'Failed to load place details' })
        }
      } finally {
        setLoading(false)
      }
    }

    loadPlace()
  }, [id])

  const handleClose = () => {
    // Navigate back or to discover page
    try {
      navigate(-1)
    } catch {
      navigate('/')
    }
  }

  const handleGo = (place) => {
    // Mark as visited and open directions in Google Maps
    markVisited(place)
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`
    import('../utils/nativePlugins').then(m => m.openExternalUrl(mapsUrl))
  }

  const web = !isNative()

  if (loading) {
    return (
      <div className="place-page">
        {web && <PlacePageHeader />}
        <div className="place-page-body">
          <LoadingState variant="spinner" message="Loading place details..." size="large" />
        </div>
      </div>
    )
  }

  if (error || !place) {
    // Determine error details based on error type
    const getErrorDetails = () => {
      if (!error) {
        return {
          title: 'Place not found',
          description: 'This place may have been removed or the link is incorrect.',
          buttonText: 'Discover places',
          buttonAction: () => navigate('/')
        }
      }

      switch (error.type) {
        case 'not_found':
          return {
            title: 'Place not found',
            description: 'This place may have been removed or the link is incorrect.',
            buttonText: 'Discover places',
            buttonAction: () => navigate('/')
          }
        case 'network':
          return {
            title: "Can't reach the internet",
            description: 'Check your connection and try again.',
            buttonText: 'Try again',
            buttonAction: () => window.location.reload()
          }
        case 'rate_limit':
          return {
            title: 'Too many requests',
            description: 'Wait a moment, then try again.',
            buttonText: 'Try again',
            buttonAction: () => window.location.reload()
          }
        default:
          return {
            title: error.message || 'Something went wrong',
            description: 'Something went wrong loading this place. Try again later.',
            buttonText: 'Go home',
            buttonAction: () => navigate('/')
          }
      }
    }

    const errorDetails = getErrorDetails()

    return (
      <div className="place-page">
        {web && <PlacePageHeader />}
        <div className="place-page-body">
          <motion.div
            className="place-page-error"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <img className="place-page-error-mark" src="/icons/icon.svg" alt="" width="64" height="64" />
            <h2>{errorDetails.title}</h2>
            <p>{errorDetails.description}</p>
            <button className="btn btn-primary" onClick={errorDetails.buttonAction}>
              {errorDetails.buttonText}
            </button>
          </motion.div>
        </div>
      </div>
    )
  }

  // In the app a shared link opens the usual sheet; on the web it is a
  // standalone page with the brand header and the get-the-app card.
  if (!web) {
    return <PlaceDetail place={place} onClose={handleClose} onGo={handleGo} />
  }

  return (
    <div className="place-page place-page--detail">
      <PlacePageHeader />
      <PlaceDetail
        place={place}
        onClose={handleClose}
        onGo={handleGo}
        variant="page"
        footer={<GetAppCard source="place" />}
      />
    </div>
  )
}

/**
 * Town Page
 *
 * In-app version of the static SEO town pages (scripts/prerender-towns.mjs).
 * Same town list (shared/towns.mjs), same Overpass proxy path Discover uses.
 * Route: /town/:slug
 */

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { TOWNS } from '../../shared/towns.mjs'
import { fetchNearbyPlaces } from '../utils/apiClient'
import { openDirections } from '../utils/navigation'
import PlaceImage from '../components/PlaceImage'
import PlaceDetail from '../components/PlaceDetail'
import LoadingState from '../components/LoadingState'
import NotFound from './NotFound'
import { useSEO } from '../hooks/useSEO'
import './Place.css'
import './TownPage.css'

// ~3.3km each way, matching the static page's bbox half-height (0.03° lat)
const TOWN_RADIUS = 3300
const PER_TOWN = 24

export default function TownPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const town = TOWNS.find(t => t.slug === slug)
  // Result is tagged with its slug so loading is derived, not reset in the effect
  const [result, setResult] = useState(null)
  const [selected, setSelected] = useState(null)
  const loading = result?.slug !== slug
  const places = loading ? [] : result.places
  const error = !loading && result.error

  useSEO({
    title: town ? `Explore ${town.name}` : 'Town',
    description: town?.blurb,
    url: `https://www.go-roam.uk/town/${slug}`
  })

  useEffect(() => {
    if (!town) return
    let cancelled = false
    fetchNearbyPlaces(town.lat, town.lng, TOWN_RADIUS)
      .then(all => {
        if (cancelled) return
        // Overpass returns ID order; surface the best-tagged places first
        const ranked = [...all].sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))
        setResult({ slug: town.slug, places: ranked.slice(0, PER_TOWN), error: false })
      })
      .catch(() => { if (!cancelled) setResult({ slug: town.slug, places: [], error: true }) })
    return () => { cancelled = true }
  }, [town])

  if (!town) return <NotFound />

  return (
    <div className="town-page">
      <button className="town-back" onClick={() => navigate(-1)} aria-label="Back">← Back</button>
      <h1 className="town-title">{town.name}</h1>
      <p className="town-lead">{town.blurb}</p>

      {loading && <LoadingState variant="spinner" message={`Finding places in ${town.name}...`} />}

      {!loading && (error || places.length === 0) && (
        <div className="place-page-error">
          <h2>Couldn't load places</h2>
          <p>Check your connection and try again.</p>
          <button className="place-page-error-btn" onClick={() => window.location.reload()}>Try Again</button>
        </div>
      )}

      {!loading && places.length > 0 && (
        <ul className="town-list">
          {places.map(place => (
            <li key={place.id}>
              <button className="town-card" onClick={() => setSelected(place)}>
                <div className="town-card-thumb">
                  <PlaceImage place={place} src={place.photo || undefined} alt="" imgProps={{ loading: 'lazy' }} />
                </div>
                <span className="town-card-name">{place.name}</span>
                {place.type && <span className="town-card-tag">{place.type.replace(/_/g, ' ')}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <AnimatePresence>
        {selected && (
          <PlaceDetail
            place={selected}
            onClose={() => setSelected(null)}
            onGo={() => openDirections(selected.lat, selected.lng, selected.name)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Town Page
 *
 * In-app version of the server-rendered town pages (api/town.js). Any town
 * on Earth: the slug is resolved by /api/town (geocoded + cached server
 * side), then places load through the same Overpass proxy path Discover uses.
 * Routes: /town/:slug, and /town/near-me which uses device GPS and
 * replaces itself with the real town's URL.
 */

import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { fetchNearbyPlaces } from '../utils/apiClient'
import { openDirections } from '../utils/navigation'
import { getCurrentPosition } from '../utils/nativePlugins'
import { getPublicShareUrl } from '../utils/nativeBridge'
import { shareContent } from '../utils/shareCard'
import { getCategoryForType } from '../utils/categories'
import { rememberTown } from '../utils/recentTowns'
import { BackIcon, ShareIcon, ChevronIcon } from './townIcons'
import CategoryIcon from '../components/icons/CategoryIcon'
import PlaceImage from '../components/PlaceImage'
import PlaceDetail from '../components/PlaceDetail'
import LoadingState from '../components/LoadingState'
import NotFound from './NotFound'
import { useSEO } from '../hooks/useSEO'
import './Place.css'
import './TownPage.css'

// ~3.3km each way, matching the web page's bbox half-height (0.03° lat)
const TOWN_RADIUS = 3300
const PER_TOWN = 24

// "historic_building" → "Historic building" (not "Historic Building")
const sentenceCase = type => {
  const t = type.replace(/_/g, ' ')
  return t[0].toUpperCase() + t.slice(1)
}

const ERRORS = {
  location: { title: 'Couldn\'t get your location', body: 'Allow location access for ROAM and try again.' },
  nowhere: { title: 'No town found here', body: 'We couldn\'t match your location to a town. Try searching for one instead.' },
  network: { title: 'Couldn\'t load places', body: 'Check your connection and try again.' },
  empty: { title: 'Nothing listed here yet', body: 'We couldn\'t find parks, sights or places to eat right around here.' }
}

async function fetchTown(params) {
  const res = await fetch(`/api/town?${params}&format=json`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`town ${res.status}`)
  return (await res.json()).town
}

export default function TownPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  // Set when we arrived by following the server's alias redirect; never follow a second
  // one, so a stale cached answer can't bounce us between two slugs forever
  const fromAlias = useLocation().state?.fromAlias === true
  // Everything is tagged with the slug it belongs to, so loading is derived, not reset in effects
  const [town, setTown] = useState(null) // { slug, data } | { slug, missing } | { slug, error }
  const [result, setResult] = useState(null)
  const [selectedPlace, setSelected] = useState(null) // { slug, place }
  const nearMe = slug === 'near-me'
  const current = town?.slug === slug ? town : null
  const info = current?.data
  const loading = !current || (info && result?.slug !== slug)
  const places = !loading && result ? result.places : []
  // Tagged with its slug so an open sheet doesn't survive navigating to another town
  const selected = selectedPlace?.slug === slug ? selectedPlace.place : null
  const [filterFor, setFilter] = useState(null) // { slug, key }, same reason
  const filter = filterFor?.slug === slug ? filterFor.key : null

  useSEO({
    title: info ? `Things to do in ${info.name}` : 'Explore a town',
    description: info?.blurb || (info ? `Parks, sights and places to eat in ${info.name}.` : undefined),
    url: `https://www.go-roam.uk/town/${slug}`
  })

  // 1. Resolve the slug (or GPS for near-me) to a town
  useEffect(() => {
    let cancelled = false
    const done = value => { if (!cancelled) setTown({ slug, ...value }) }
    if (nearMe) {
      getCurrentPosition()
        .catch(() => { throw Object.assign(new Error('location'), { location: true }) })
        .then(pos => fetchTown(`near=${pos.coords.latitude.toFixed(4)},${pos.coords.longitude.toFixed(4)}`))
        .then(t => {
          if (cancelled) return
          if (t) navigate(`/town/${t.slug}`, { replace: true })
          else done({ error: 'nowhere' })
        })
        .catch(err => done({ error: err.location ? 'location' : 'network' }))
    } else {
      fetchTown(`slug=${encodeURIComponent(slug)}`)
        .then(t => {
          if (!t) return done({ missing: true })
          // Aliases collapse to one URL, same as the web. The server only ever
          // returns a slug that resolves to itself, so this can't ping-pong.
          if (t.slug !== slug && !fromAlias) return navigate(`/town/${t.slug}`, { replace: true, state: { fromAlias: true } })
          done({ data: { ...t, slug } })
        })
        .catch(() => done({ error: 'network' }))
    }
    return () => { cancelled = true }
  }, [slug, nearMe, navigate, fromAlias])

  // 2. Load its places
  useEffect(() => {
    if (!info) return
    rememberTown(info)
    let cancelled = false
    fetchNearbyPlaces(info.lat, info.lng, TOWN_RADIUS)
      .then(all => {
        if (cancelled) return
        // Overpass returns ID order; surface the best-tagged places first
        const ranked = [...all].sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))
        setResult({ slug: info.slug, places: ranked.slice(0, PER_TOWN), error: false })
      })
      .catch(() => { if (!cancelled) setResult({ slug: info.slug, places: [], error: true }) })
    return () => { cancelled = true }
  }, [info])

  if (current?.missing) return <NotFound />

  const problem = current?.error || (!loading && (result?.error ? 'network' : places.length === 0 ? 'empty' : null))

  const share = () => shareContent({
    title: `Things to do in ${info.name}`,
    text: `Parks, sights and places to eat in ${info.name}, on ROAM`,
    url: getPublicShareUrl(`/town/${info.slug}`)
  })
  // Chips for the app's categories actually present, same as Wishlist's filters
  const categories = [...new Map(places
    .map(p => getCategoryForType(p.type))
    .filter(Boolean)
    .map(c => [c.key, c])).values()]
  const shown = filter ? places.filter(p => getCategoryForType(p.type)?.key === filter) : places

  const where = info ? [info.region !== info.name ? info.region : null, info.country].filter(Boolean).join(', ') : ''

  return (
    <div className="town-page">
      <div className="town-top">
        <button className="town-back" onClick={() => navigate(-1)} aria-label="Back"><BackIcon /></button>
        {info && <button className="town-share" onClick={share}><ShareIcon />Share</button>}
      </div>
      <h1 className="town-title">{info ? info.name : nearMe ? 'Near you' : 'Town'}</h1>
      {where && <p className="town-where">{where}</p>}
      {info?.blurb && <p className="town-lead">{info.blurb}</p>}

      {loading && !current?.error && (
        <LoadingState variant="spinner" message={info ? `Finding places in ${info.name}...` : nearMe ? 'Finding your town...' : 'Finding town...'} />
      )}

      {problem && (
        <div className="place-page-error">
          <h2>{ERRORS[problem].title}</h2>
          <p>{ERRORS[problem].body}</p>
          {(problem === 'network' || problem === 'location') && (
            <button className="place-page-error-btn" onClick={() => window.location.reload()}>Try Again</button>
          )}
        </div>
      )}

      {!loading && categories.length > 1 && (
        <div className="town-chips town-filters" role="group" aria-label="Filter by category">
          <button className={`chip ${filter ? '' : 'selected'}`} onClick={() => setFilter(null)}>All</button>
          {categories.map(c => (
            <button key={c.key} className={`chip ${filter === c.key ? 'selected' : ''}`} onClick={() => setFilter({ slug, key: c.key })}>
              <CategoryIcon name={c.key} size="sm" />{c.label}
            </button>
          ))}
        </div>
      )}

      {!loading && places.length > 0 && (
        <ul className="town-list">
          {shown.map(place => (
            <li key={place.id}>
              <button className="town-card" onClick={() => setSelected({ slug, place })}>
                <div className="town-card-thumb">
                  <PlaceImage place={place} categoryKey={getCategoryForType(place.type)?.key} src={place.photo || undefined} alt="" imgProps={{ loading: 'lazy' }} />
                </div>
                <span className="town-card-name">{place.name}</span>
                {place.type && <span className="town-card-tag">{sentenceCase(place.type)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {(info || problem) && (
        <Link className="town-near town-more" to="/town">
          <span className="town-near-text">
            <strong>Explore another town</strong>
            <span>Search anywhere, or pick a popular town</span>
          </span>
          <span className="town-near-chevron"><ChevronIcon /></span>
        </Link>
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

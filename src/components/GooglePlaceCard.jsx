/**
 * Google rating, reviews, photo and live hours for a place, rendered by
 * Google's own Places UI Kit element (the only Places surface Google allows
 * beside our Leaflet map). We never read or store the data it shows.
 *
 * Nothing loads until the user taps "Show Google reviews & hours": each load
 * is a billed Places UI Kit Query (10k free a month, then $1 per 1,000), and
 * most place views never need it. The ID lookup is Text Search IDs Only
 * (free). Before the tap, failures show nothing; after it, a no-match, error or
 * 15 s silence says Google reviews aren't available.
 * Render with key={place.id}: state is per place.
 */
import { useEffect, useRef, useState } from 'react'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import {
  cachedGooglePlaceId, canShowGoogleCard, disableGoogleCardForSession, findGooglePlaceId, forgetGooglePlaceId,
  googleMapsKey, isAuthFailure, loadPlacesLibrary,
} from '../utils/googlePlaces'
import { recordApiCall } from '../utils/apiTelemetry'
import './GooglePlaceCard.css'

const LOAD_TIMEOUT_MS = 15000

function logFailure(error) {
  if (isAuthFailure(error)) disableGoogleCardForSession()
  recordApiCall({ source: 'google-places', duration: 0, status: 'error', error: String(error?.message || error || 'unknown') })
}

export default function GooglePlaceCard({ place }) {
  const online = useOnlineStatus()
  const [requested, setRequested] = useState(false)
  // A remembered "no match" (cachedGooglePlaceId === null) offers nothing to tap. Only
  // before the tap: the lookup caches its own no-match, and the answer must still show
  // Online is checked before the tap only: once asked for, the card stays mounted
  // through a signal blip (unmounting it lost Google's element for good)
  const eligible = Boolean(googleMapsKey()) && canShowGoogleCard(place) &&
    (requested || (online && cachedGooglePlaceId(place?.id) !== null))
  const boxRef = useRef(null)
  const [googleId, setGoogleId] = useState(null)
  const [status, setStatus] = useState('pending') // pending | loaded | failed

  // Keyed on the place id only: enrichment filling in town or tidier
  // coordinates later must not start a second lookup.
  const placeId = place?.id
  useEffect(() => {
    if (!eligible || !requested) return
    let cancelled = false
    const { id, name, lat, lng, town, city, type } = place
    // A cached id skips the search, but the element still needs the Maps
    // script to define it; a cached "no match" loads nothing from Google.
    findGooglePlaceId({ id, name, lat, lng, town, city, type })
      .then(async (gid) => {
        if (gid) await loadPlacesLibrary()
        if (cancelled) return
        if (gid) setGoogleId(gid)
        else setStatus('failed')
      })
      .catch((err) => { if (!cancelled) { setStatus('failed'); logFailure(err) } })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the place id only (see above)
  }, [eligible, requested, placeId])

  // Built with DOM calls, not JSX: React 19 sets JSX props on a defined
  // custom element as properties, and Google's property setters throw on
  // the attribute spellings (orientation="horizontal" crashed the page).
  useEffect(() => {
    const box = boxRef.current
    if (!googleId || !box) return
    const el = document.createElement('gmp-place-details-compact')
    const onLoad = () => setStatus(prev => (prev === 'failed' ? prev : 'loaded')) // a load after the timeout keeps the message
    const onError = (e) => {
      // Google refused this id (stale or wrong): forget it so the next
      // visit searches again instead of repeating the failure for a year
      forgetGooglePlaceId(placeId)
      setStatus('failed')
      logFailure(e?.error || 'gmp-error')
    }
    el.addEventListener('gmp-load', onLoad)
    el.addEventListener('gmp-error', onError)
    // Google's element may never answer (a refused key, a dead connection):
    // don't leave the user on "Loading…"
    const timer = setTimeout(() => setStatus(prev => (prev === 'loaded' ? prev : 'failed')), LOAD_TIMEOUT_MS)
    try {
      el.setAttribute('orientation', 'horizontal')
      const request = document.createElement('gmp-place-details-place-request')
      request.setAttribute('place', googleId)
      el.append(request, document.createElement('gmp-place-all-content'))
      box.append(el)
    } catch (err) {
      onError({ error: err })
    }
    return () => {
      clearTimeout(timer)
      el.removeEventListener('gmp-load', onLoad)
      el.removeEventListener('gmp-error', onError)
      el.remove()
    }
  }, [googleId, placeId])

  if (!eligible) return null
  // Asked, but Google had nothing (no match, refused key, gmp-error): say so
  // rather than a button that silently disappears
  if (status === 'failed') {
    return requested ? <p className="google-place-card-none" role="status">Google reviews aren't available for this place right now.</p> : null
  }

  return (
    <>
      {status !== 'loaded' && (
        <button type="button" className="google-place-card-open" onClick={() => setRequested(true)} disabled={requested} aria-busy={requested}>
          {requested ? 'Loading Google reviews…' : 'Show Google reviews & hours'}
        </button>
      )}
      <div
        ref={boxRef}
        className={`google-place-card${status === 'loaded' ? ' is-loaded' : ''}`}
        inert={status !== 'loaded'}
      />
    </>
  )
}

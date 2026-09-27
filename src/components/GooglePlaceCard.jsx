/**
 * Google rating, reviews, photo and live hours for a place, rendered by
 * Google's own Places UI Kit element (the only Places surface Google allows
 * beside our Leaflet map). We never read or store the data it shows.
 *
 * Nothing loads until the card nears the viewport, so swiping Discover
 * cards never pulls in Google. Any failure (no key, offline, no match,
 * blocked referrer, gmp-error) leaves the card collapsed and invisible.
 * Render with key={place.id}: state is per place.
 */
import { useEffect, useRef, useState } from 'react'
import { useNearViewport } from '../hooks/useNearViewport'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import {
  canShowGoogleCard, disableGoogleCardForSession, findGooglePlaceId, forgetGooglePlaceId,
  googleMapsKey, isAuthFailure, loadPlacesLibrary,
} from '../utils/googlePlaces'
import { recordApiCall } from '../utils/apiTelemetry'
import './GooglePlaceCard.css'

function logFailure(error) {
  if (isAuthFailure(error)) disableGoogleCardForSession()
  recordApiCall({ source: 'google-places', duration: 0, status: 'error', error: String(error?.message || error || 'unknown') })
}

export default function GooglePlaceCard({ place }) {
  const online = useOnlineStatus()
  const eligible = Boolean(googleMapsKey()) && online && canShowGoogleCard(place)
  const boxRef = useRef(null)
  const near = useNearViewport(boxRef, eligible)
  const [googleId, setGoogleId] = useState(null)
  const [status, setStatus] = useState('pending') // pending | loaded | failed

  // Keyed on the place id only: enrichment filling in town or tidier
  // coordinates later must not start a second lookup.
  const placeId = place?.id
  useEffect(() => {
    if (!eligible || !near) return
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
  }, [eligible, near, placeId])

  // Built with DOM calls, not JSX: React 19 sets JSX props on a defined
  // custom element as properties, and Google's property setters throw on
  // the attribute spellings (orientation="horizontal" crashed the page).
  useEffect(() => {
    const box = boxRef.current
    if (!googleId || !box) return
    const el = document.createElement('gmp-place-details-compact')
    const onLoad = () => setStatus('loaded')
    const onError = (e) => {
      // Google refused this id (stale or wrong): forget it so the next
      // visit searches again instead of repeating the failure for a year
      forgetGooglePlaceId(placeId)
      setStatus('failed')
      logFailure(e?.error || 'gmp-error')
    }
    el.addEventListener('gmp-load', onLoad)
    el.addEventListener('gmp-error', onError)
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
      el.removeEventListener('gmp-load', onLoad)
      el.removeEventListener('gmp-error', onError)
      el.remove()
    }
  }, [googleId, placeId])

  if (!eligible || status === 'failed') return null

  return (
    <div
      ref={boxRef}
      className={`google-place-card${status === 'loaded' ? ' is-loaded' : ''}`}
      inert={status !== 'loaded'}
    />
  )
}

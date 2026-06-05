/**
 * /partners/events/new   — create a promoted event
 * /partners/events/:id    — edit / pay / view stats for an existing one
 *
 * One component, mode inferred from the route param. A paid event becomes
 * read-only and shows performance stats; an unpaid one is editable and offers
 * "Pay & publish".
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../hooks/useToast'
import EventCard from '../../components/EventCard'
import ConfirmDialog from './ConfirmDialog'
import {
  getPartnerEvent, createPartnerEvent, updatePartnerEvent,
  getPromoQuote, startPromoCheckout, formatPence
} from '../../utils/partnersClient'
import { geocodeAddress } from '../../utils/apiClient/geocode'
import { ReachIcon, CheckIcon, StarIcon, PinIcon, SparkIcon, MegaphoneIcon, ArrowLeftIcon } from './icons'
import './Partners.css'

// Preset key → icon component, and band key → ReachIcon level.
const PRESET_ICONS = { taster: SparkIcon, standard: StarIcon, bignight: MegaphoneIcon }
const BAND_LEVEL = { local: 1, town: 2, city: 3, region: 4 }

// How attendees get in — drives the in-app card's call-to-action.
// online + door can combine; free is exclusive (nothing to buy either way).
const TICKET_TYPE_OPTIONS = [
  { key: 'online', label: 'Tickets online', hint: 'Sold via a link' },
  { key: 'door', label: 'Pay on the door', hint: 'Cash/card at venue' },
  { key: 'free', label: 'Free entry', hint: 'No ticket needed' }
]

// The stored enum is a single value; the UI lets online + door co-exist.
function admissionState(tt) {
  return {
    online: tt === 'online' || tt === 'online_door',
    door: tt === 'door' || tt === 'online_door',
    free: tt === 'free'
  }
}
function encodeAdmission({ online, door }) {
  if (online && door) return 'online_door'
  if (door) return 'door'
  return 'online' // default to online when neither is set
}

const CATEGORIES = [
  ['music', 'Music'], ['comedy', 'Comedy'], ['theatre', 'Theatre'], ['sports', 'Sports'],
  ['nightlife', 'Nightlife'], ['food', 'Food & Drink'], ['family', 'Family'],
  ['culture', 'Culture'], ['entertainment', 'Entertainment']
]

// Static fallback so the band selector renders before the quote returns
// options; the server stays the source of truth for the actual price.
const FALLBACK_BANDS = [
  { key: 'local', label: 'Local', maxKm: 10, dayPence: 150 },
  { key: 'town', label: 'Town', maxKm: 25, dayPence: 250 },
  { key: 'city', label: 'City', maxKm: 50, dayPence: 400 },
  { key: 'region', label: 'Region', maxKm: 100, dayPence: 600 }
]
const FALLBACK_PRESETS = [
  { key: 'taster', label: 'Taster', radiusKm: 10, days: 7, blurb: 'Local reach, one week' },
  { key: 'standard', label: 'Standard', radiusKm: 25, days: 14, blurb: 'Town reach, two weeks', recommended: true },
  { key: 'bignight', label: 'Big night', radiusKm: 50, days: 30, blurb: 'City reach, one month' }
]

function bandForRadius(bands, km) {
  const r = Number(km)
  return bands.find(b => r <= b.maxKm) || bands[bands.length - 1]
}
function addDaysIso(baseIso, days) {
  const d = baseIso ? new Date(baseIso) : new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function PartnerEvent() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const { showToast } = useToast()
  const [searchParams] = useSearchParams()
  const isNew = !id
  const savedRef = useRef(null) // JSON snapshot of the last-saved form (dirty tracking)

  const [form, setForm] = useState(blankForm)
  const [event, setEvent] = useState(null)
  const [loadState, setLoadState] = useState(isNew ? 'ready' : 'loading')
  const [quote, setQuote] = useState(null)
  const [options, setOptions] = useState({ bands: FALLBACK_BANDS, presets: FALLBACK_PRESETS })
  const [geo, setGeo] = useState({ status: 'idle', message: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirmTimedOut, setConfirmTimedOut] = useState(false)
  const [reviewing, setReviewing] = useState(false)

  const paid = event?.payment_status === 'paid'
  const paidBanner = searchParams.get('paid') // 'success' | 'cancelled'

  // Load existing event
  const load = useCallback(async () => {
    try {
      const res = await getPartnerEvent(id)
      setEvent(res.event)
      const f = eventToForm(res.event)
      setForm(f)
      savedRef.current = JSON.stringify(f)
      setLoadState('ready')
    } catch (err) {
      if (err.code === 'NO_PARTNER' || err.status === 401) { navigate('/partners'); return }
      setLoadState('error')
    }
  }, [id, navigate])

  useEffect(() => {
    if (authLoading) return
    if (!user) { navigate('/partners'); return }
    if (!isNew) load()
  }, [authLoading, user, isNew, load, navigate])

  // Returning from Stripe (?paid=success) races the webhook — confirm the REAL
  // payment_status by polling briefly, rather than claiming "live" from a URL.
  const awaitingConfirmation = paidBanner === 'success' && !!event && !paid
  useEffect(() => {
    if (!awaitingConfirmation) return
    setConfirmTimedOut(false)
    let stop = false
    let attempts = 0
    const tick = async () => {
      if (stop) return
      if (attempts >= 10) { setConfirmTimedOut(true); return }
      attempts++
      try {
        const res = await getPartnerEvent(id)
        if (stop) return
        setEvent(res.event)
        if (res.event?.payment_status === 'paid') return
      } catch { /* keep trying */ }
      if (!stop) timer = setTimeout(tick, 2500)
    }
    let timer = setTimeout(tick, 2000)
    return () => { stop = true; clearTimeout(timer) }
  }, [awaitingConfirmation, id])

  // Refresh quote whenever radius / dates change and are valid.
  useEffect(() => {
    let cancelled = false
    const { promo_radius_km, promo_starts_on, promo_ends_on, push_boost } = form
    if (!promo_starts_on || !promo_ends_on) { setQuote(null); return }
    getPromoQuote({ radiusKm: promo_radius_km, promo_starts_on, promo_ends_on, pushBoost: push_boost })
      .then((res) => {
        if (cancelled) return
        setQuote(res.quote)
        if (res.options?.bands?.length) setOptions(res.options)
      })
      .catch(() => { if (!cancelled) setQuote(null) })
    return () => { cancelled = true }
    // Re-quote only when targeting (radius/dates/boost) changes — not every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.promo_radius_km, form.promo_starts_on, form.promo_ends_on, form.push_boost])

  // Snapshot the initial form for a NEW event so "dirty" is meaningful.
  useEffect(() => {
    if (isNew && savedRef.current == null) savedRef.current = JSON.stringify(form)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew])

  const isDirty = savedRef.current != null && JSON.stringify(form) !== savedRef.current

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!isDirty) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))

  const onUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
      const res = await fetch('/api/contributions/upload', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': file.type,
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: file
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Upload failed')
      setForm((f) => ({ ...f, image_url: data.url }))
    } catch (err) {
      setError(err?.message || 'Image upload failed')
    } finally {
      setUploading(false)
    }
  }

  const geocode = async () => {
    const address = form.address.trim()
    if (!address) { setGeo({ status: 'error', message: 'Enter an address first.' }); return }
    setGeo({ status: 'loading', message: '' })
    try {
      const coords = await geocodeAddress(address)
      if (coords && typeof coords.lat === 'number') {
        setForm((f) => ({ ...f, lat: coords.lat, lng: coords.lng }))
        setGeo({ status: 'ok', message: `Pinned to ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` })
      } else {
        setGeo({ status: 'error', message: 'Couldn’t find that address — drop coordinates manually below.' })
      }
    } catch {
      setGeo({ status: 'error', message: 'Lookup failed — drop coordinates manually below.' })
    }
  }

  const applyPreset = (preset) => {
    const start = isoDate(0)
    setForm((f) => ({
      ...f,
      promo_radius_km: preset.radiusKm,
      promo_starts_on: start,
      promo_ends_on: addDaysIso(start, preset.days - 1)
    }))
  }

  const selectBand = (band) => setForm((f) => ({ ...f, promo_radius_km: band.maxKm }))

  // Admission: online + door toggle independently; free is exclusive; never empty.
  const toggleAdmission = (key) => setForm((f) => {
    if (key === 'free') return { ...f, ticket_type: 'free' }
    const cur = admissionState(f.ticket_type)
    const base = cur.free ? { online: false, door: false } : cur
    const next = { ...base, [key]: !base[key] }
    if (!next.online && !next.door) next[key] = true // keep at least one paid option
    return { ...f, ticket_type: encodeAdmission(next) }
  })

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      const payload = formToPayload(form)
      if (isNew) {
        const res = await createPartnerEvent(payload)
        savedRef.current = JSON.stringify(form)
        navigate(`/partners/events/${res.event.id}`)
      } else {
        const res = await updatePartnerEvent({ id: Number(id), ...payload })
        setEvent(res.event)
        savedRef.current = JSON.stringify(form)
        showToast('Saved', 'success')
      }
    } catch (err) {
      setError(err?.message || 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  const payNow = async () => {
    setBusy(true)
    setError('')
    try {
      // Persist latest edits first so the price matches what's shown.
      if (!isNew) await updatePartnerEvent({ id: Number(id), ...formToPayload(form) })
      const res = await startPromoCheckout(Number(id))
      if (res?.url) window.location.href = res.url
    } catch (err) {
      setError(err?.message || 'Could not start checkout')
      setBusy(false)
      setReviewing(false)
    }
  }

  // Live, pixel-accurate preview of the in-app Featured card. No promotedId →
  // EventCard's impression tracking never fires for the preview.
  const previewEvent = useMemo(() => ({
    id: 'preview',
    isFeatured: true,
    source: 'roam_promoted',
    name: (form.title || '').trim() || 'Your event title',
    description: (form.description || '').trim(),
    datetime: { start: form.starts_at ? new Date(form.starts_at) : null },
    venue: {
      name: (form.venue_name || '').trim() || (form.address || '').trim() || 'Your venue',
      address: (form.address || '').trim()
    },
    categories: form.category ? [form.category] : [],
    pricing: previewPricing(form),
    isSoldOut: false,
    imageUrl: form.image_url || null,
    ticketUrl: form.info_url || null,
    ticketType: form.ticket_type
  }), [form])

  if (loadState === 'loading') return (
    <Shell onBack={() => navigate('/partners/dashboard')}>
      <div className="partners-skel partners-skel-title" />
      <section className="partners-card" aria-hidden="true">
        <div className="partners-skel partners-skel-line" style={{ width: '40%' }} />
        <div className="partners-skel partners-skel-card" />
        <div className="partners-skel partners-skel-line" style={{ width: '70%' }} />
      </section>
    </Shell>
  )
  if (loadState === 'error') return <Shell><p className="partners-error">Couldn’t load this event.</p></Shell>

  return (
    <Shell onBack={() => navigate('/partners/dashboard')}>
      <h1 className="partners-h1">{isNew ? 'Create an event' : paid ? form.title : 'Edit event'}</h1>

      {/* Only claim "live" once payment_status is actually 'paid'. */}
      {paid && paidBanner === 'success' && (
        <div className="partners-banner success"><StarIcon size={18} /> Payment received — your event is live.</div>
      )}
      {paidBanner === 'cancelled' && !paid && (
        <div className="partners-banner">Checkout cancelled. You can pay whenever you’re ready.</div>
      )}

      {awaitingConfirmation && (
        <section className="partners-card partners-confirming">
          <span className="partners-spinner" aria-hidden="true" />
          <div>
            <h2>{confirmTimedOut ? 'Still confirming your payment' : 'Confirming your payment…'}</h2>
            <p className="partners-muted small">
              {confirmTimedOut
                ? 'This is taking longer than usual. Your card was charged — please don’t pay again. It’ll go live automatically once confirmed; refresh in a minute or contact support if it persists.'
                : 'Just a moment — your event goes live the instant payment is confirmed. No need to pay again.'}
            </p>
          </div>
        </section>
      )}

      {paid && event && (
        <section className="partners-card">
          <span className="partners-status s-active">Live</span>
          <div className="partners-stat-grid">
            <Stat label="Views" value={event.stats?.impressions ?? 0} />
            <Stat label="Clicks" value={event.stats?.clicks ?? 0} />
            <Stat label="Saves" value={event.stats?.saves ?? 0} />
          </div>
          <p className="partners-muted small">
            Showing within {event.promo_radius_km}km from {fmtDate(event.promo_starts_on)} to {fmtDate(event.promo_ends_on)}.
          </p>
          <p className="partners-muted small">
            Paid {formatPence(event.price_paid_pence)}{event.push_boost ? ' (incl. nearby-phone push)' : ''} · a receipt has been emailed to you.
          </p>
        </section>
      )}

      {!awaitingConfirmation && (isNew || (event && event.status !== 'cancelled' && event.status !== 'expired')) && (
        <>
          <section className="partners-card partners-preview-panel">
            <h2>Preview</h2>
            <p className="partners-muted small">Exactly how it appears in the app’s “What’s On” feed.</p>
            {/* inert removes the preview's descendants from tab order AND the a11y
                tree, so the focusable CTA inside isn't a hidden keyboard trap. */}
            <div className="partners-preview-frame" {...{ inert: '' }}>
              <EventCard event={previewEvent} variant="full" />
            </div>
          </section>

          <section className="partners-card">
            <h2>Event details</h2>
            <div className="partners-form">
              <label>
                <span className="partners-label-row">Title * <span className="partners-count">{(form.title || '').length}/160</span></span>
                <input value={form.title} onChange={set('title')} maxLength={160} placeholder="e.g. Riverside Summer Jazz Night" />
              </label>
              <label>
                <span className="partners-label-row">Description <span className="partners-count">{(form.description || '').length}/2000</span></span>
                <textarea rows={4} value={form.description} onChange={set('description')} maxLength={2000} placeholder="What's the event? Who's it for? What makes it worth a night out?" />
              </label>
              <label>Category
                <select value={form.category} onChange={set('category')}>
                  <option value="">—</option>
                  {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label>Venue name<input value={form.venue_name} onChange={set('venue_name')} maxLength={200} /></label>
              <div className="partners-field">
                <label htmlFor="pe-address">Address</label>
                <div className="partners-inline">
                  <input id="pe-address" value={form.address} onChange={set('address')} maxLength={300}
                    placeholder="12 High Street, Hastings" />
                  <button type="button" className="partners-btn ghost sm partners-find" onClick={geocode}
                    disabled={geo.status === 'loading'}>
                    <PinIcon size={16} /> {geo.status === 'loading' ? 'Finding…' : 'Find on map'}
                  </button>
                </div>
                <p className={`partners-hint ${geo.status === 'error' ? 'is-error' : 'is-ok'}`} aria-live="polite">{geo.message}</p>
              </div>
              <p className="partners-hint">Type the address and tap “Find on map” — we’ll place the pin for you.</p>
              <details className="partners-advanced">
                <summary>Set exact coordinates</summary>
                <div className="partners-row">
                  <label>Latitude *<input type="number" step="any" value={form.lat} onChange={set('lat')} placeholder="51.5074" /></label>
                  <label>Longitude *<input type="number" step="any" value={form.lng} onChange={set('lng')} placeholder="-0.1278" /></label>
                </div>
                <p className="partners-hint">Usually filled by “Find on map”. Paste from Google Maps (right-click → coordinates) if needed.</p>
              </details>
              <div className="partners-row">
                <label>Starts *<input type="datetime-local" value={form.starts_at} onChange={set('starts_at')} /></label>
                <label>Ends<input type="datetime-local" value={form.ends_at} onChange={set('ends_at')} /></label>
              </div>
              <div className="partners-field">
                <span className="partners-field-label">Admission</span>
                <div className="partners-segment">
                  {TICKET_TYPE_OPTIONS.map((t) => {
                    const active = admissionState(form.ticket_type)[t.key]
                    return (
                      <button type="button" key={t.key}
                        className={`partners-seg ${active ? 'active' : ''}`}
                        onClick={() => toggleAdmission(t.key)}
                        aria-pressed={active}>
                        <span className="partners-seg-label">
                          {t.label}{active && <CheckIcon size={13} />}
                        </span>
                        <span className="partners-seg-hint">{t.hint}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="partners-hint">Sold both ways? Pick “Tickets online” and “Pay on the door” together.</p>
              </div>
              <div className="partners-row">
                <label>
                  {admissionState(form.ticket_type).online ? 'Ticket link' : 'More info link (optional)'}
                  <input type="url" placeholder="https://…" value={form.info_url} onChange={set('info_url')} />
                </label>
                <label>Price text
                  <input placeholder={admissionState(form.ticket_type).free ? 'Free' : 'e.g. £10'} value={form.price_info} onChange={set('price_info')} maxLength={60} />
                </label>
              </div>
              {admissionState(form.ticket_type).online && !form.info_url && (
                <p className="partners-hint is-error">Online events need a ticket link so people can buy.</p>
              )}
              <label>Event image
                <input type="file" accept="image/*" onChange={onUpload} disabled={uploading} />
              </label>
              <p className="partners-muted small" aria-live="polite">{uploading ? 'Uploading…' : ''}</p>
              {form.image_url && <img className="partners-preview" src={form.image_url} alt="Event" />}
            </div>
          </section>

          {paid ? (
          <section className="partners-card">
            <h2>Promotion</h2>
            <div className="partners-review">
              <div className="partners-review-row"><span>Reach</span><strong>within {event.promo_radius_km}km</strong></div>
              <div className="partners-review-row"><span>Featured</span><strong>{fmtDate(event.promo_starts_on)} – {fmtDate(event.promo_ends_on)}</strong></div>
              <div className="partners-review-row"><span>Paid</span><strong>{formatPence(event.price_paid_pence)}{event.push_boost ? ' (incl. nearby-phone push)' : ''}</strong></div>
            </div>
            <p className="partners-hint">Reach, dates and price are locked once your event is live. To change them, create a new promotion.</p>
          </section>
          ) : (
          <section className="partners-card">
            <h2>Promotion</h2>
            <p className="partners-muted small">Pick a package, or set your own reach and dates below.</p>

            <div className="partners-presets">
              {options.presets.map((p) => {
                const Icon = PRESET_ICONS[p.key] || StarIcon
                const active = isPresetActive(form, p)
                return (
                  <button type="button" key={p.key}
                    className={`partners-preset ${active ? 'active' : ''}`}
                    onClick={() => applyPreset(p)} aria-pressed={active}>
                    {p.recommended && <span className="partners-preset-tag">Popular</span>}
                    <span className="partners-preset-icon"><Icon /></span>
                    <span className="partners-preset-name">{p.label}</span>
                    <span className="partners-preset-blurb">{p.blurb}</span>
                  </button>
                )
              })}
            </div>

            <div className="partners-form">
              <div className="partners-field">
                <span className="partners-field-label">Reach</span>
                <div className="partners-bands">
                  {options.bands.map((b) => {
                    const active = bandForRadius(options.bands, form.promo_radius_km).key === b.key
                    return (
                      <button type="button" key={b.key}
                        className={`partners-band ${active ? 'active' : ''}`}
                        onClick={() => selectBand(b)} aria-pressed={active}>
                        <span className="partners-band-icon"><ReachIcon level={BAND_LEVEL[b.key] || 1} /></span>
                        <span className="partners-band-name">
                          {b.label}{active && <CheckIcon size={14} />}
                        </span>
                        <span className="partners-band-meta">to {b.maxKm}km · {formatPence(b.dayPence)}/day</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="partners-row">
                <label>Show from *<input type="date" value={form.promo_starts_on} onChange={set('promo_starts_on')} /></label>
                <label>Show until *<input type="date" value={form.promo_ends_on} onChange={set('promo_ends_on')} /></label>
              </div>

              <button type="button"
                className={`partners-boost ${form.push_boost ? 'active' : ''}`}
                onClick={() => setForm((f) => ({ ...f, push_boost: !f.push_boost }))}
                aria-pressed={form.push_boost}>
                <span className="partners-boost-ic"><MegaphoneIcon /></span>
                <span className="partners-boost-text">
                  <span className="partners-boost-title">Notify nearby phones <span className="partners-boost-price">+£15</span></span>
                  <span className="partners-boost-desc">Send a one-off push to opted-in ROAM users near you when this goes live.</span>
                </span>
                <span className={`partners-boost-check ${form.push_boost ? 'on' : ''}`}>
                  {form.push_boost && <CheckIcon size={15} />}
                </span>
              </button>

              <div className="partners-quote">
                {quote
                  ? <>
                      <span className="partners-price">{formatPence(quote.pricePence)}</span>
                      <span className="partners-muted small">
                        {quote.band?.label || ''} reach · {quote.days} day{quote.days === 1 ? '' : 's'}{quote.pushBoost ? ' · incl. £15 nearby-phone push' : ''} · one-off, no subscription
                      </span>
                    </>
                  : <span className="partners-muted small">Choose your reach and dates to see the price.</span>}
              </div>
            </div>
          </section>
          )}

          {error && <p className="partners-error" role="alert">{error}</p>}

          {!isNew && (
            <p className={`partners-savestate ${isDirty ? 'dirty' : ''}`} aria-live="polite">
              {isDirty ? '● Unsaved changes' : '✓ All changes saved'}
            </p>
          )}

          {paid ? (
            <div className="partners-actions sticky">
              <button className="partners-btn primary" disabled={busy || !isDirty} onClick={save}>
                {busy ? 'Saving…' : isDirty ? 'Save changes' : 'Saved'}
              </button>
            </div>
          ) : (
            <>
              <div className="partners-actions sticky">
                <button className="partners-btn ghost" disabled={busy || !isDirty} onClick={save}>
                  {busy ? 'Saving…' : isNew ? 'Save draft' : isDirty ? 'Save changes' : 'Saved'}
                </button>
                {!isNew && (
                  <button className="partners-btn primary"
                    disabled={busy || !quote || (admissionState(form.ticket_type).online && !String(form.info_url).trim())}
                    onClick={() => setReviewing(true)}>
                    {busy ? '…' : `Pay ${quote ? formatPence(quote.pricePence) : ''} & publish`}
                  </button>
                )}
              </div>
              {isNew && <p className="partners-hint">Save your draft first, then pay to publish.</p>}
            </>
          )}
        </>
      )}

      <ConfirmDialog
        open={reviewing && !!quote}
        title="Review & pay"
        body={quote ? (
          <div className="partners-review">
            <div className="partners-review-row"><span>Event</span><strong>{(form.title || '').trim() || 'Your event'}</strong></div>
            <div className="partners-review-row"><span>Featured</span><strong>{fmtDate(form.promo_starts_on)} – {fmtDate(form.promo_ends_on)} ({quote.days}d)</strong></div>
            <div className="partners-review-row"><span>Reach</span><strong>{quote.band?.label} · within {quote.radiusKm}km</strong></div>
            {form.push_boost && <div className="partners-review-row"><span>Nearby-phone push</span><strong>+£15</strong></div>}
            <div className="partners-review-row total"><span>Total</span><strong>{formatPence(quote.pricePence)}</strong></div>
            <p className="partners-muted small">One-off — no subscription. You’ll pay securely on Stripe.</p>
          </div>
        ) : null}
        confirmLabel={quote ? `Pay ${formatPence(quote.pricePence)}` : 'Pay'}
        cancelLabel="Back"
        busy={busy}
        onConfirm={payNow}
        onCancel={() => setReviewing(false)}
      />
    </Shell>
  )
}

function Shell({ children, onBack }) {
  return (
    <div className="partners-shell">
      <header className="partners-bar">
        <button className="partners-back" onClick={onBack || (() => history.back())}>
          <ArrowLeftIcon /> Dashboard
        </button>
      </header>
      <main className="partners-main">{children}</main>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="partners-stat">
      <span className="partners-stat-value">{Number(value)}</span>
      <span className="partners-stat-label">{label}</span>
    </div>
  )
}

function blankForm() {
  const today = isoDate(0)
  // Sensible defaults: a week out, 7–10pm — feels considered, not a blank slate.
  const start = new Date(); start.setDate(start.getDate() + 7); start.setHours(19, 0, 0, 0)
  const end = new Date(start.getTime() + 3 * 3600 * 1000)
  return {
    title: '', description: '', category: '', venue_name: '', address: '',
    lat: '', lng: '', starts_at: toLocalInput(start), ends_at: toLocalInput(end),
    info_url: '', price_info: '', image_url: '',
    ticket_type: 'online', push_boost: false,
    promo_radius_km: 25, promo_starts_on: today, promo_ends_on: isoDate(14)
  }
}

function eventToForm(ev) {
  return {
    title: ev.title || '', description: ev.description || '', category: ev.category || '',
    venue_name: ev.venue_name || '', address: ev.address || '',
    lat: ev.lat ?? '', lng: ev.lng ?? '',
    starts_at: toLocalInput(ev.starts_at), ends_at: toLocalInput(ev.ends_at),
    info_url: ev.info_url || '', price_info: ev.price_info || '', image_url: ev.image_url || '',
    ticket_type: ev.ticket_type || 'online', push_boost: !!ev.push_boost,
    promo_radius_km: ev.promo_radius_km || 25,
    promo_starts_on: (ev.promo_starts_on || '').slice(0, 10),
    promo_ends_on: (ev.promo_ends_on || '').slice(0, 10)
  }
}

function formToPayload(f) {
  return {
    title: f.title, description: f.description || null, category: f.category || null,
    venue_name: f.venue_name || null, address: f.address || null,
    lat: f.lat === '' ? null : Number(f.lat), lng: f.lng === '' ? null : Number(f.lng),
    starts_at: f.starts_at ? new Date(f.starts_at).toISOString() : null,
    ends_at: f.ends_at ? new Date(f.ends_at).toISOString() : null,
    info_url: f.info_url || null, price_info: f.price_info || null, image_url: f.image_url || null,
    ticket_type: f.ticket_type || 'online',
    push_boost: !!f.push_boost,
    promo_radius_km: Number(f.promo_radius_km),
    promo_starts_on: f.promo_starts_on, promo_ends_on: f.promo_ends_on
  }
}

function isoDate(addDays) {
  const d = new Date()
  d.setDate(d.getDate() + addDays)
  return d.toISOString().slice(0, 10)
}
function toLocalInput(value) {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d)) return ''
  const off = d.getTimezoneOffset()
  const local = new Date(d.getTime() - off * 60000)
  return local.toISOString().slice(0, 16)
}
function fmtDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (isNaN(d)) return '—'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
function daysBetween(a, b) {
  if (!a || !b) return null
  const d1 = new Date(a); const d2 = new Date(b)
  if (isNaN(d1) || isNaN(d2)) return null
  return Math.floor((d2 - d1) / 86400000) + 1
}
function isPresetActive(form, preset) {
  if (Number(form.promo_radius_km) !== preset.radiusKm) return false
  return daysBetween(form.promo_starts_on, form.promo_ends_on) === preset.days
}
function previewPricing(f) {
  if (f.ticket_type === 'free' || /free/i.test(f.price_info || '')) {
    return { isFree: true, minPrice: 0, maxPrice: 0, currency: 'GBP' }
  }
  const m = (f.price_info || '').replace(/,/g, '').match(/\d+(\.\d+)?/)
  return { isFree: false, minPrice: m ? Number(m[0]) : null, maxPrice: null, currency: 'GBP' }
}

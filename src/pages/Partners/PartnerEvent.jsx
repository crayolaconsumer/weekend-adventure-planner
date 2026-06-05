/**
 * /partners/events/new   — create a promoted event
 * /partners/events/:id    — edit / pay / view stats for an existing one
 *
 * One component, mode inferred from the route param. A paid event becomes
 * read-only and shows performance stats; an unpaid one is editable and offers
 * "Pay & publish".
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import {
  getPartnerEvent, createPartnerEvent, updatePartnerEvent,
  getPromoQuote, startPromoCheckout, formatPence
} from '../../utils/partnersClient'
import './Partners.css'

const CATEGORIES = [
  ['music', 'Music'], ['comedy', 'Comedy'], ['theatre', 'Theatre'], ['sports', 'Sports'],
  ['nightlife', 'Nightlife'], ['food', 'Food & Drink'], ['family', 'Family'],
  ['culture', 'Culture'], ['entertainment', 'Entertainment']
]
const RADII = [5, 10, 25, 50, 100]

export default function PartnerEvent() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const isNew = !id

  const [form, setForm] = useState(blankForm)
  const [event, setEvent] = useState(null)
  const [loadState, setLoadState] = useState(isNew ? 'ready' : 'loading')
  const [quote, setQuote] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)

  const paid = event?.payment_status === 'paid'
  const paidBanner = searchParams.get('paid') // 'success' | 'cancelled'

  // Load existing event
  const load = useCallback(async () => {
    try {
      const res = await getPartnerEvent(id)
      setEvent(res.event)
      setForm(eventToForm(res.event))
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

  // Refresh quote whenever radius / dates change and are valid.
  useEffect(() => {
    let cancelled = false
    const { promo_radius_km, promo_starts_on, promo_ends_on } = form
    if (!promo_starts_on || !promo_ends_on) { setQuote(null); return }
    getPromoQuote({ radiusKm: promo_radius_km, promo_starts_on, promo_ends_on })
      .then((res) => { if (!cancelled) setQuote(res.quote) })
      .catch(() => { if (!cancelled) setQuote(null) })
    return () => { cancelled = true }
    // Re-quote only when targeting (radius/dates) changes — not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.promo_radius_km, form.promo_starts_on, form.promo_ends_on])

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

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      const payload = formToPayload(form)
      if (isNew) {
        const res = await createPartnerEvent(payload)
        navigate(`/partners/events/${res.event.id}`)
      } else {
        const res = await updatePartnerEvent({ id: Number(id), ...payload })
        setEvent(res.event)
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
    }
  }

  if (loadState === 'loading') return <Shell><p className="partners-muted">Loading…</p></Shell>
  if (loadState === 'error') return <Shell><p className="partners-error">Couldn’t load this event.</p></Shell>

  return (
    <Shell onBack={() => navigate('/partners/dashboard')}>
      <h1 className="partners-h1">{isNew ? 'Create an event' : paid ? form.title : 'Edit event'}</h1>

      {paidBanner === 'success' && <div className="partners-banner success">Payment received — your event is live. 🎉</div>}
      {paidBanner === 'cancelled' && <div className="partners-banner">Checkout cancelled. You can pay whenever you’re ready.</div>}

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
        </section>
      )}

      {!paid && (
        <>
          <section className="partners-card">
            <h2>Event details</h2>
            <div className="partners-form">
              <label>Title *<input value={form.title} onChange={set('title')} maxLength={160} /></label>
              <label>Description<textarea rows={4} value={form.description} onChange={set('description')} maxLength={2000} /></label>
              <label>Category
                <select value={form.category} onChange={set('category')}>
                  <option value="">—</option>
                  {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <div className="partners-row">
                <label>Venue name<input value={form.venue_name} onChange={set('venue_name')} maxLength={200} /></label>
                <label>Address<input value={form.address} onChange={set('address')} maxLength={300} /></label>
              </div>
              <div className="partners-row">
                <label>Latitude *<input type="number" step="any" value={form.lat} onChange={set('lat')} placeholder="51.5074" /></label>
                <label>Longitude *<input type="number" step="any" value={form.lng} onChange={set('lng')} placeholder="-0.1278" /></label>
              </div>
              <p className="partners-hint">Tip: right-click your venue in Google Maps to copy its coordinates.</p>
              <div className="partners-row">
                <label>Starts *<input type="datetime-local" value={form.starts_at} onChange={set('starts_at')} /></label>
                <label>Ends<input type="datetime-local" value={form.ends_at} onChange={set('ends_at')} /></label>
              </div>
              <div className="partners-row">
                <label>Ticket / info link<input type="url" placeholder="https://…" value={form.info_url} onChange={set('info_url')} /></label>
                <label>Price text<input placeholder="Free, £10…" value={form.price_info} onChange={set('price_info')} maxLength={60} /></label>
              </div>
              <label>Event image
                <input type="file" accept="image/*" onChange={onUpload} disabled={uploading} />
              </label>
              {uploading && <p className="partners-muted small">Uploading…</p>}
              {form.image_url && <img className="partners-preview" src={form.image_url} alt="Event" />}
            </div>
          </section>

          <section className="partners-card">
            <h2>Promotion</h2>
            <div className="partners-form">
              <label>Broadcast radius
                <select value={form.promo_radius_km} onChange={set('promo_radius_km')}>
                  {RADII.map((r) => <option key={r} value={r}>{r} km</option>)}
                </select>
              </label>
              <div className="partners-row">
                <label>Show from *<input type="date" value={form.promo_starts_on} onChange={set('promo_starts_on')} /></label>
                <label>Show until *<input type="date" value={form.promo_ends_on} onChange={set('promo_ends_on')} /></label>
              </div>
              <div className="partners-quote">
                {quote
                  ? <><span className="partners-price">{formatPence(quote.pricePence)}</span>
                      <span className="partners-muted small">{quote.days} day(s) · {quote.radiusKm}km · one-off, no subscription</span></>
                  : <span className="partners-muted small">Choose a radius and dates to see the price.</span>}
              </div>
            </div>
          </section>

          {error && <p className="partners-error">{error}</p>}

          <div className="partners-actions sticky">
            <button className="partners-btn ghost" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : isNew ? 'Save draft' : 'Save changes'}
            </button>
            {!isNew && (
              <button className="partners-btn primary" disabled={busy || !quote} onClick={payNow}>
                {busy ? '…' : `Pay ${quote ? formatPence(quote.pricePence) : ''} & publish`}
              </button>
            )}
          </div>
          {isNew && <p className="partners-hint">Save your draft first, then pay to publish.</p>}
        </>
      )}
    </Shell>
  )
}

function Shell({ children, onBack }) {
  return (
    <div className="partners-shell">
      <header className="partners-bar">
        <button className="partners-link" onClick={onBack || (() => history.back())}>← Dashboard</button>
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
  return {
    title: '', description: '', category: '', venue_name: '', address: '',
    lat: '', lng: '', starts_at: '', ends_at: '', info_url: '', price_info: '', image_url: '',
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

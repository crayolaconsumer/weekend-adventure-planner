/**
 * /partners/dashboard — list the partner's events with live stats and actions.
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import {
  listPartnerEvents, cancelPartnerEvent, startPromoCheckout, formatPence
} from '../../utils/partnersClient'
import './Partners.css'

const STATUS_LABELS = {
  draft: 'Draft',
  pending_payment: 'Awaiting payment',
  active: 'Live',
  expired: 'Ended',
  cancelled: 'Cancelled'
}

export default function PartnerDashboard() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [events, setEvents] = useState([])
  const [state, setState] = useState('loading') // loading | ready | error
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await listPartnerEvents()
      setEvents(res?.events || [])
      setState('ready')
    } catch (err) {
      if (err.code === 'NO_PARTNER' || err.status === 401) { navigate('/partners'); return }
      setState('error')
    }
  }, [navigate])

  useEffect(() => {
    if (loading) return
    if (!user) { navigate('/partners'); return }
    load()
  }, [loading, user, load, navigate])

  const pay = async (id) => {
    setBusyId(id)
    try {
      const res = await startPromoCheckout(id)
      if (res?.url) window.location.href = res.url
    } catch (err) {
      alert(err?.message || 'Could not start checkout')
      setBusyId(null)
    }
  }

  const cancel = async (id) => {
    if (!confirm('Cancel this event? This cannot be undone.')) return
    setBusyId(id)
    try {
      await cancelPartnerEvent(id)
      await load()
    } catch (err) {
      alert(err?.message || 'Could not cancel')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="partners-shell">
      <header className="partners-bar">
        <button className="partners-link" onClick={() => navigate('/partners')}>← Partner home</button>
        <button className="partners-btn primary sm" onClick={() => navigate('/partners/events/new')}>+ New event</button>
      </header>

      <main className="partners-main">
        <h1 className="partners-h1">Your events</h1>

        {state === 'loading' && <p className="partners-muted">Loading…</p>}
        {state === 'error' && <p className="partners-error">Couldn’t load your events. <button className="partners-link" onClick={load}>Retry</button></p>}

        {state === 'ready' && events.length === 0 && (
          <div className="partners-empty">
            <p>You haven’t created any events yet.</p>
            <button className="partners-btn primary" onClick={() => navigate('/partners/events/new')}>Create your first event</button>
          </div>
        )}

        {state === 'ready' && events.length > 0 && (
          <ul className="partners-list">
            {events.map((ev) => (
              <li key={ev.id} className="partners-event">
                <div className="partners-event-main" onClick={() => navigate(`/partners/events/${ev.id}`)}>
                  <div className="partners-event-head">
                    <span className={`partners-status s-${ev.status}`}>{STATUS_LABELS[ev.status] || ev.status}</span>
                    {ev.payment_status === 'unpaid' && <span className="partners-status s-unpaid">Unpaid</span>}
                    {ev.moderation_status === 'removed' && <span className="partners-status s-removed">Removed</span>}
                  </div>
                  <h3>{ev.title}</h3>
                  <p className="partners-muted small">
                    {fmtDate(ev.starts_at)} · {ev.promo_radius_km}km radius · {formatPence(ev.price_paid_pence)}
                  </p>
                  <p className="partners-stats">
                    {Number(ev.impressions || 0)} views · {Number(ev.clicks || 0)} clicks · {Number(ev.saves || 0)} saves
                  </p>
                </div>
                <div className="partners-event-actions">
                  {ev.payment_status === 'unpaid' && ev.status !== 'cancelled' && (
                    <button className="partners-btn primary sm" disabled={busyId === ev.id} onClick={() => pay(ev.id)}>
                      {busyId === ev.id ? '…' : `Pay ${formatPence(ev.price_paid_pence)}`}
                    </button>
                  )}
                  <button className="partners-btn ghost sm" onClick={() => navigate(`/partners/events/${ev.id}`)}>Edit</button>
                  {ev.status !== 'cancelled' && (
                    <button className="partners-btn danger sm" disabled={busyId === ev.id} onClick={() => cancel(ev.id)}>Cancel</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

function fmtDate(value) {
  if (!value) return 'Date TBA'
  const d = new Date(value)
  if (isNaN(d)) return 'Date TBA'
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

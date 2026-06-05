/**
 * /partners/dashboard — list the partner's events with live stats and actions.
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../hooks/useToast'
import {
  listPartnerEvents, cancelPartnerEvent, startPromoCheckout, formatPence
} from '../../utils/partnersClient'
import ConfirmDialog from './ConfirmDialog'
import { ArrowLeftIcon, PlusIcon, MegaphoneIcon } from './icons'
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
  const { showToast } = useToast()
  const [events, setEvents] = useState([])
  const [state, setState] = useState('loading') // loading | ready | error
  const [busyId, setBusyId] = useState(null)
  const [confirmId, setConfirmId] = useState(null) // event pending cancel-confirmation

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
      showToast(err?.message || 'We couldn’t open checkout — nothing was charged.', 'error')
      setBusyId(null)
    }
  }

  const confirmCancel = async () => {
    const id = confirmId
    setBusyId(id)
    try {
      await cancelPartnerEvent(id)
      setConfirmId(null)
      await load()
      showToast('Event cancelled.', 'success')
    } catch (err) {
      showToast(err?.message || 'Could not cancel that event.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const openEvent = (id) => navigate(`/partners/events/${id}`)

  return (
    <div className="partners-shell">
      <header className="partners-bar">
        <button className="partners-back" onClick={() => navigate('/partners')}>
          <ArrowLeftIcon /> Partner home
        </button>
        <button className="partners-btn primary sm" onClick={() => navigate('/partners/events/new')}>
          <PlusIcon size={15} /> New event
        </button>
      </header>

      <main className="partners-main">
        <h1 className="partners-h1">Your events</h1>

        {state === 'ready' && events.length > 0 && (() => {
          const totals = events.reduce((a, e) => ({
            live: a.live + (e.status === 'active' ? 1 : 0),
            views: a.views + Number(e.impressions || 0),
            clicks: a.clicks + Number(e.clicks || 0),
            saves: a.saves + Number(e.saves || 0)
          }), { live: 0, views: 0, clicks: 0, saves: 0 })
          return (
            <div className="partners-overview">
              <div className="partners-overview-stat"><span className="num">{totals.live}</span><span className="lbl">Live now</span></div>
              <div className="partners-overview-stat"><span className="num">{totals.views.toLocaleString('en-GB')}</span><span className="lbl">Views</span></div>
              <div className="partners-overview-stat"><span className="num">{totals.clicks.toLocaleString('en-GB')}</span><span className="lbl">Clicks</span></div>
              <div className="partners-overview-stat"><span className="num">{totals.saves.toLocaleString('en-GB')}</span><span className="lbl">Saves</span></div>
            </div>
          )
        })()}

        {state === 'loading' && (
          <ul className="partners-list" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="partners-event">
                <div className="partners-event-main">
                  <div className="partners-skel partners-skel-line" style={{ width: '30%' }} />
                  <div className="partners-skel partners-skel-line" style={{ width: '70%', height: 18 }} />
                  <div className="partners-skel partners-skel-line" style={{ width: '50%' }} />
                </div>
              </li>
            ))}
          </ul>
        )}

        {state === 'error' && (
          <p className="partners-error" role="alert">
            Couldn’t load your events. <button className="partners-link" onClick={load}>Retry</button>
          </p>
        )}

        {state === 'ready' && events.length === 0 && (
          <div className="partners-empty">
            <span className="partners-empty-icon"><MegaphoneIcon size={26} /></span>
            <h2>Get your first event seen</h2>
            <p className="partners-muted">Create an event and promote it to locals — it can be live in minutes.</p>
            <button className="partners-btn primary" onClick={() => navigate('/partners/events/new')}>
              <PlusIcon size={15} /> Create your first event
            </button>
          </div>
        )}

        {state === 'ready' && events.length > 0 && (
          <ul className="partners-list">
            {events.map((ev) => (
              <li key={ev.id} className="partners-event">
                {ev.image_url && (
                  <img className="partners-event-thumb" src={ev.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                )}
                <div
                  className="partners-event-main"
                  role="button"
                  tabIndex={0}
                  aria-label={`Edit ${ev.title}`}
                  onClick={() => openEvent(ev.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEvent(ev.id) } }}
                >
                  <div className="partners-event-head">
                    <span className={`partners-status s-${ev.status}`}>{STATUS_LABELS[ev.status] || ev.status}</span>
                    {ev.payment_status === 'unpaid' && ev.status !== 'cancelled' && <span className="partners-status s-unpaid">Unpaid</span>}
                    {ev.moderation_status === 'removed' && <span className="partners-status s-removed">Removed</span>}
                  </div>
                  <h3>{ev.title}</h3>
                  <p className="partners-muted small">
                    {fmtDate(ev.starts_at)} · {ev.promo_radius_km}km radius · {formatPence(ev.price_paid_pence)}
                  </p>
                  <p className="partners-stats">
                    {Number(ev.impressions || 0).toLocaleString('en-GB')} views · {Number(ev.clicks || 0).toLocaleString('en-GB')} clicks · {Number(ev.saves || 0).toLocaleString('en-GB')} saves
                  </p>
                </div>
                <div className="partners-event-actions">
                  {ev.payment_status === 'unpaid' && ev.status !== 'cancelled' && (
                    <button className="partners-btn primary sm" disabled={busyId === ev.id} onClick={() => pay(ev.id)}>
                      {busyId === ev.id ? 'Opening…' : `Pay ${formatPence(ev.price_paid_pence)}`}
                    </button>
                  )}
                  <button className="partners-btn ghost sm" onClick={() => openEvent(ev.id)}>Edit</button>
                  {ev.status !== 'cancelled' && ev.payment_status !== 'paid' && (
                    <button className="partners-btn danger sm" disabled={busyId === ev.id} onClick={() => setConfirmId(ev.id)}>Cancel</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      <ConfirmDialog
        open={confirmId != null}
        title="Cancel this event?"
        body="This removes the draft and can’t be undone. (Paid events can’t be cancelled here — contact support for a refund.)"
        confirmLabel="Cancel event"
        busyLabel="Cancelling…"
        cancelLabel="Keep it"
        danger
        busy={busyId === confirmId}
        onConfirm={confirmCancel}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  )
}

function fmtDate(value) {
  if (!value) return 'Date TBA'
  const d = new Date(value)
  if (isNaN(d)) return 'Date TBA'
  // Same day/month/year format as the event editor's promo dates (no weekday)
  // so a partner sees one consistent date style across the portal.
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

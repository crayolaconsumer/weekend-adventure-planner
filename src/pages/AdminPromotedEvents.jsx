/**
 * AdminPromotedEvents — operator moderation for self-serve promoted events.
 *
 * The safety net for the auto-publish model: lists every promoted event with
 * partner + stats, and lets an operator remove (or restore) one. Removal sets
 * moderation_status='removed' so it immediately stops serving in the app.
 */

import { useState, useEffect, useCallback } from 'react'
import { useToast } from '../hooks/useToast'
import AdminLayout from '../components/AdminLayout'
import './AdminPromotedEvents.css'

function authHeaders() {
  const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'live', label: 'Live' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'removed', label: 'Removed' },
]

function formatPence(p) {
  return `£${((Number(p) || 0) / 100).toFixed(2)}`
}
function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
  catch { return '—' }
}

export default function AdminPromotedEvents() {
  const { showToast } = useToast()
  const [events, setEvents] = useState([])
  const [filter, setFilter] = useState('')
  const [state, setState] = useState('loading')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setState('loading')
    try {
      const qs = filter ? `?moderation=${filter}` : ''
      const res = await fetch(`/api/admin/promoted-events${qs}`, {
        credentials: 'include',
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      setEvents(data.events || [])
      setState('ready')
    } catch {
      setState('error')
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  const moderate = async (id, moderation_status) => {
    const verb = moderation_status === 'removed' ? 'Remove' : 'Restore'
    if (!confirm(`${verb} this event?`)) return
    setBusyId(id)
    try {
      const res = await fetch('/api/admin/promoted-events', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id, moderation_status }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data?.code === 'FRESH_LOGIN_REQUIRED') {
          showToast('Please sign in again to moderate', 'error')
        } else {
          showToast(data?.error || 'Action failed', 'error')
        }
        return
      }
      showToast(`Event ${moderation_status === 'removed' ? 'removed' : 'restored'}`, 'success')
      await load()
    } catch {
      showToast('Action failed', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const filterActions = (
    <div className="ape-filters">
      {FILTERS.map((f) => (
        <button
          key={f.value || 'all'}
          className={`ape-filter ${filter === f.value ? 'active' : ''}`}
          onClick={() => setFilter(f.value)}
        >{f.label}</button>
      ))}
    </div>
  )

  return (
    <AdminLayout
      title="Promoted Events"
      subtitle="Self-serve Featured events — moderate or remove"
      actions={filterActions}
    >
      {state === 'loading' && <p className="ape-muted">Loading…</p>}
      {state === 'error' && <p className="ape-error">Couldn’t load events. <button className="ape-link" onClick={load}>Retry</button></p>}
      {state === 'ready' && events.length === 0 && <p className="ape-muted">No promoted events{filter ? ` (${filter})` : ''} yet.</p>}

      {state === 'ready' && events.length > 0 && (
        <div className="ape-list">
          {events.map((ev) => (
            <div key={ev.id} className={`ape-row ${ev.moderation_status === 'removed' ? 'is-removed' : ''}`}>
              <div className="ape-row-main">
                <div className="ape-badges">
                  <span className={`ape-badge mod-${ev.moderation_status}`}>{ev.moderation_status}</span>
                  <span className="ape-badge stat">{ev.status}</span>
                  <span className={`ape-badge pay-${ev.payment_status}`}>{ev.payment_status}</span>
                </div>
                <h3 className="ape-title">{ev.title}</h3>
                <p className="ape-meta">
                  {ev.org_name} · {ev.contact_email} · {fmtDate(ev.starts_at)} · {ev.promo_radius_km}km · {formatPence(ev.price_paid_pence)}
                </p>
                <p className="ape-stats">{Number(ev.impressions || 0)} views · {Number(ev.clicks || 0)} clicks · {Number(ev.saves || 0)} saves</p>
                {ev.info_url && <a className="ape-link" href={ev.info_url} target="_blank" rel="noreferrer">Info link ↗</a>}
              </div>
              <div className="ape-actions">
                {ev.moderation_status !== 'removed' ? (
                  <button className="ape-btn danger" disabled={busyId === ev.id} onClick={() => moderate(ev.id, 'removed')}>
                    {busyId === ev.id ? '…' : 'Remove'}
                  </button>
                ) : (
                  <button className="ape-btn" disabled={busyId === ev.id} onClick={() => moderate(ev.id, 'live')}>
                    {busyId === ev.id ? '…' : 'Restore'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminLayout>
  )
}

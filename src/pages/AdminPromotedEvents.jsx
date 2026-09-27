/**
 * AdminPromotedEvents: operator moderation for self-serve promoted events.
 *
 * The safety net for the auto-publish model: lists promoted events with
 * partner and stats, and lets an operator remove (or restore) one.
 * Removal sets moderation_status='removed' so it stops serving at once.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useToast } from '../hooks/useToast'
import AdminLayout from '../components/AdminLayout'
import AdminStatus from '../components/AdminStatus'
import ConfirmModal from '../components/ConfirmModal'
import { formatDate, timeAgo } from '../components/adminFormat'
import './AdminPromotedEvents.css'
import { authHeaders } from '../utils/authToken'

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'live', label: 'Live' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'removed', label: 'Removed' },
]

const MOD_TONE = { live: 'ok', flagged: 'warn', removed: 'danger' }
const PAY_TONE = { paid: 'ok', unpaid: 'warn', refunded: 'danger' }
const sentence = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '')

function formatPence(p) {
  return `£${((Number(p) || 0) / 100).toFixed(2)}`
}

export default function AdminPromotedEvents() {
  const toast = useToast()
  const [events, setEvents] = useState([])
  const [filter, setFilter] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [pending, setPending] = useState(null) // { ev, moderation_status }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = filter ? `?moderation=${filter}` : ''
      const res = await fetch(`/api/admin/promoted-events${qs}`, { credentials: 'include', headers: authHeaders() })
      if (!res.ok) throw new Error(`The server answered ${res.status}`)
      const data = await res.json()
      setEvents(data.events || [])
    } catch (err) {
      setError(err.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  const moderate = async () => {
    if (!pending) return
    const { ev, moderation_status } = pending
    setPending(null)
    setBusyId(ev.id)
    try {
      const res = await fetch('/api/admin/promoted-events', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: ev.id, moderation_status }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data?.code === 'FRESH_LOGIN_REQUIRED'
          ? 'Sign in again, then retry. Moderation needs a login from the last 30 minutes.'
          : data?.error || 'That didn\'t work. Try again.')
        return
      }
      toast.success(`Event ${moderation_status === 'removed' ? 'removed' : 'restored'}`)
      await load()
    } catch {
      toast.error('That didn\'t work. Check your connection and try again.')
    } finally {
      setBusyId(null)
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return events
    return events.filter((ev) => [ev.title, ev.org_name, ev.contact_email, ev.venue_name].some((v) => String(v || '').toLowerCase().includes(q)))
  }, [events, query])

  return (
    <AdminLayout title="Promoted events" subtitle="Self-serve featured events from venues and organisers. Remove anything that breaks the rules.">
      <div className="admin-toolbar">
        <div className="admin-chips" role="group" aria-label="Filter by moderation status">
          {FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              type="button"
              className={`chip${filter === f.value ? ' selected' : ''}`}
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
            >{f.label}</button>
          ))}
        </div>
        <div className="admin-search" role="search">
          <input type="search" placeholder="Search title, organiser or email" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search promoted events" />
        </div>
      </div>

      <AdminStatus
        loading={loading}
        error={error}
        onRetry={load}
        empty={visible.length === 0}
        emptyTitle={query ? 'No events match' : 'No promoted events'}
        emptyText={query ? 'Try a shorter search.' : 'Events that venues and organisers promote will appear here.'}
      >
        <div className="admin-table-wrap">
          <table className="admin-table ape-table">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Status</th>
                <th scope="col">Date</th>
                <th scope="col" className="num">Paid</th>
                <th scope="col" className="num">Views</th>
                <th scope="col" className="num">Clicks</th>
                <th scope="col" className="num">Saves</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((ev) => (
                <tr key={ev.id} className={ev.moderation_status === 'removed' ? 'is-removed' : ''}>
                  <td className="ape-event">
                    <strong>{ev.title}</strong>
                    <span className="admin-muted">{ev.org_name} · {ev.contact_email}</span>
                    <span className="admin-muted">{ev.promo_radius_km} km radius · created {timeAgo(ev.created_at)}{ev.info_url && <> · <a href={ev.info_url} target="_blank" rel="noreferrer">Info link ↗</a></>}</span>
                  </td>
                  <td>
                    <div className="ape-badges">
                      <span className={`admin-badge admin-badge-${MOD_TONE[ev.moderation_status] || 'warn'}`}>{sentence(ev.moderation_status)}</span>
                      <span className="admin-badge">{sentence(ev.status)}</span>
                      <span className={`admin-badge admin-badge-${PAY_TONE[ev.payment_status] || 'warn'}`}>{sentence(ev.payment_status)}</span>
                    </div>
                  </td>
                  <td>{formatDate(ev.starts_at)}</td>
                  <td className="num">{formatPence(ev.price_paid_pence)}</td>
                  <td className="num">{Number(ev.impressions || 0).toLocaleString('en-GB')}</td>
                  <td className="num">{Number(ev.clicks || 0).toLocaleString('en-GB')}</td>
                  <td className="num">{Number(ev.saves || 0).toLocaleString('en-GB')}</td>
                  <td>
                    {ev.moderation_status !== 'removed' ? (
                      <button type="button" className="btn btn-danger btn-sm" disabled={busyId === ev.id} onClick={() => setPending({ ev, moderation_status: 'removed' })}>
                        {busyId === ev.id ? 'Removing…' : 'Remove'}
                      </button>
                    ) : (
                      <button type="button" className="btn btn-secondary btn-sm" disabled={busyId === ev.id} onClick={() => setPending({ ev, moderation_status: 'live' })}>
                        {busyId === ev.id ? 'Restoring…' : 'Restore'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="admin-pager"><span>Showing {visible.length.toLocaleString('en-GB')} of {events.length.toLocaleString('en-GB')} (newest 200)</span></div>
      </AdminStatus>

      <ConfirmModal
        isOpen={!!pending}
        title={pending?.moderation_status === 'removed' ? 'Remove this event?' : 'Restore this event?'}
        message={pending?.moderation_status === 'removed'
          ? `"${pending?.ev.title}" stops showing in the app straight away. You can restore it later.`
          : `"${pending?.ev.title}" starts showing in the app again.`}
        confirmLabel={pending?.moderation_status === 'removed' ? 'Remove event' : 'Restore event'}
        destructive={pending?.moderation_status === 'removed'}
        onConfirm={moderate}
        onCancel={() => setPending(null)}
      />
    </AdminLayout>
  )
}

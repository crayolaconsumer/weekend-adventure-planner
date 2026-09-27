/**
 * AdminActivity — append-only audit log of admin actions.
 *
 * Drill-down target for the dashboard's Audit log card and the
 * "View all →" link on the Recently strip. Every destructive admin
 * action (ban, hide content, cancel campaign, etc.) is appended to
 * admin_actions; this page just renders them chronologically with
 * filter chips by category.
 */

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useToast } from '../hooks/useToast'
import AdminLayout from '../components/AdminLayout'
import AdminStatus from '../components/AdminStatus'
import { timeAgo, formatDateTime, describeAction } from '../components/adminFormat'
import './AdminActivity.css'
import { authHeaders } from '../utils/authToken'

const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'reports', label: 'Reports' },
  { value: 'campaigns', label: 'Campaigns' },
  { value: 'users', label: 'Users' },
]

export default function AdminActivity() {
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()
  const initialCategory = CATEGORIES.some(c => c.value === searchParams.get('category'))
    ? searchParams.get('category')
    : 'all'

  const PAGE_SIZE = 100
  const [category, setCategory] = useState(initialCategory)
  const [actions, setActions] = useState([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    // Write-only URL sync via the prev-callback form. Including
    // `searchParams` in deps would infinite-loop because setSearchParams
    // produces a new URLSearchParams object on every call.
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (category === 'all') next.delete('category')
      else next.set('category', category)
      return next
    }, { replace: true })
  }, [category, setSearchParams])

  const load = useCallback(async ({ append = false, offset = 0 } = {}) => {
    if (append) setLoadingMore(true)
    else { setLoading(true); setError(null) }
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      if (category !== 'all') params.set('category', category)
      const res = await fetch(`/api/admin/activity?${params}`, {
        credentials: 'include',
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error(`The server answered ${res.status}`)
      const data = await res.json()
      setActions(prev => append ? [...prev, ...(data.actions || [])] : (data.actions || []))
      setTotal(data.total || 0)
      setHasMore(!!data.hasMore)
    } catch (err) {
      if (append) toast.error(`Couldn't load more: ${err.message}`)
      else setError(err.message || 'Network error')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [category, toast])

  useEffect(() => { load({ append: false, offset: 0 }) }, [load])

  const loadMore = () => {
    load({ append: true, offset: actions.length })
  }

  return (
    <AdminLayout
      title="Audit log"
      subtitle={`${total} admin action${total === 1 ? '' : 's'} on record${category !== 'all' ? ` · ${category}` : ''}`}
    >
      <div className="admin-toolbar">
        <div className="admin-chips" role="group" aria-label="Filter actions">
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              type="button"
              className={`chip${category === c.value ? ' selected' : ''}`}
              aria-pressed={category === c.value}
              onClick={() => setCategory(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <AdminStatus
        loading={loading}
        error={error}
        onRetry={() => load()}
        empty={actions.length === 0}
        emptyTitle="No actions logged"
        emptyText={category === 'all' ? 'Bans, deletions, report decisions and campaign changes are recorded here.' : `No ${category} actions yet.`}
      >
        <div className="admin-table-wrap">
          <table className="admin-table admin-activity-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">What happened</th>
                <th scope="col">Action</th>
                <th scope="col">IP</th>
              </tr>
            </thead>
            <tbody>
              {actions.map(row => (
                <tr key={row.id}>
                  <td className="admin-activity-when" title={formatDateTime(row.created_at)}>
                    {timeAgo(row.created_at)}
                    <span className="admin-muted">{formatDateTime(row.created_at)}</span>
                  </td>
                  <td>
                    <strong>@{row.admin_username || `admin ${row.admin_id}`}</strong> {describeAction(row)}
                  </td>
                  <td><code className="admin-activity-code">{row.action}</code></td>
                  <td className="admin-muted">{row.ip || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="admin-pager">
          <span>Showing {actions.length.toLocaleString('en-GB')} of {total.toLocaleString('en-GB')}</span>
          {hasMore && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </AdminStatus>
    </AdminLayout>
  )
}

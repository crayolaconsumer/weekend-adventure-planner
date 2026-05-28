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
import './AdminActivity.css'

const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'reports', label: 'Reports' },
  { value: 'campaigns', label: 'Campaigns' },
  { value: 'users', label: 'Users' },
]

function authHeaders() {
  const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function describeAction(row) {
  const action = row.action || ''
  const targetType = row.target_type || ''
  const targetId = row.target_id || ''
  // For report.* actions, target_id is the reported entity id (a
  // contribution, review, photo, etc.). The id of the user who got
  // banned via that report is stored in metadata.reportedUserId by
  // api/admin/reports.js — using target_id here would falsely accuse
  // the entity id of being a user. user.ban / user.unban actions from
  // /api/admin/users.js store username in metadata.
  const username = row.metadata?.username
  const reportedUserId = row.metadata?.reportedUserId

  if (action.startsWith('report.dismiss')) return `dismissed report on ${targetType} #${targetId}`
  if (action.startsWith('report.review')) return `marked report on ${targetType} #${targetId} as reviewed`
  if (action.startsWith('report.action.hide_content')) return `hid contribution #${targetId}`
  if (action.startsWith('report.action.hide_review')) return `hid review text on rating #${targetId}`
  if (action.startsWith('report.action.ban_user')) {
    const bannedId = reportedUserId ?? targetId
    return `banned user #${bannedId} (via report on ${targetType} #${targetId})`
  }
  if (action.startsWith('report.')) return `actioned report on ${targetType} #${targetId}`
  if (action.startsWith('campaign.create.active')) return `created and activated campaign #${targetId}`
  if (action.startsWith('campaign.create.draft')) return `created campaign #${targetId} (draft)`
  if (action.startsWith('campaign.create')) return `created campaign #${targetId}`
  if (action.startsWith('campaign.update')) return `updated campaign #${targetId}`
  if (action.startsWith('campaign.cancel')) return `cancelled campaign #${targetId}`
  if (action.startsWith('user.ban')) return `banned user #${targetId}${username ? ` (@${username})` : ''}`
  if (action.startsWith('user.unban')) return `unbanned user #${targetId}${username ? ` (@${username})` : ''}`
  return `${action} on ${targetType || 'something'} #${targetId}`
}

function timeAgo(ts) {
  if (!ts) return ''
  const diff = (Date.now() - new Date(ts).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDateTime(ts) {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return ''
  }
}

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
    else setLoading(true)
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setActions(prev => append ? [...prev, ...(data.actions || [])] : (data.actions || []))
      setTotal(data.total || 0)
      setHasMore(!!data.hasMore)
    } catch (err) {
      toast.error(`Failed to load activity: ${err.message}`)
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
      <div className="admin-activity">
        <div className="admin-activity-filters" role="group" aria-label="Filter actions">
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              type="button"
              className={`admin-activity-chip ${category === c.value ? 'active' : ''}`}
              onClick={() => setCategory(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="admin-activity-loading">Loading…</p>
        ) : actions.length === 0 ? (
          <p className="admin-activity-empty">
            {category === 'all'
              ? 'No admin actions recorded yet.'
              : `No ${category} actions in the log.`}
          </p>
        ) : (
          <>
            <ol className="admin-activity-list">
              {actions.map(row => (
                <li key={row.id} className="admin-activity-row">
                  <div className="admin-activity-when">
                    <span className="admin-activity-relative">{timeAgo(row.created_at)}</span>
                    <span className="admin-activity-absolute">{formatDateTime(row.created_at)}</span>
                  </div>
                  <div className="admin-activity-body">
                    <div className="admin-activity-line">
                      <strong>@{row.admin_username || `admin ${row.admin_id}`}</strong>
                      {' '}{describeAction(row)}
                    </div>
                    {row.ip && <div className="admin-activity-ip">IP {row.ip}</div>}
                  </div>
                  <code className="admin-activity-action">{row.action}</code>
                </li>
              ))}
            </ol>
            {hasMore && (
              <div className="admin-activity-loadmore">
                <button
                  type="button"
                  className="admin-activity-loadmore-btn"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading…' : `Load more (${total - actions.length} remaining)`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  )
}

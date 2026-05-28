/**
 * AdminUsers
 *
 * Browse and manage all signed-up users. Drill-down target for the
 * Premium / New users / Banned cards on the dashboard. Ban toggle is
 * gated by a confirmation modal (consistent with the existing Reports
 * flow). The API is the real auth gate; this page is advisory.
 *
 * URL params (read on mount, sync to filter chips):
 *   ?filter=all|premium|new|banned|inactive
 *   ?search=<text>
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useToast } from '../hooks/useToast'
import ConfirmModal from '../components/ConfirmModal'
import AdminLayout from '../components/AdminLayout'
import './AdminUsers.css'

const FILTER_CHIPS = [
  { value: 'all', label: 'All' },
  { value: 'premium', label: 'Premium' },
  { value: 'new', label: 'New (30d)' },
  { value: 'banned', label: 'Banned' },
  { value: 'inactive', label: 'Inactive (30d)' },
]

function authHeaders() {
  const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function formatDate(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function timeSince(ts) {
  if (!ts) return 'never'
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 0) return 'just now'
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export default function AdminUsers() {
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()

  const initialFilter = searchParams.get('filter') || 'all'
  const initialSearch = searchParams.get('search') || ''

  const [filter, setFilter] = useState(initialFilter)
  const [searchInput, setSearchInput] = useState(initialSearch)
  const [search, setSearch] = useState(initialSearch)
  const PAGE_SIZE = 100
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [actingId, setActingId] = useState(null)
  const [banConfirm, setBanConfirm] = useState(null) // { user, is_banned } | null

  // Keep URL params in sync (write-only — see AdminAds.jsx for the
  // same pattern + reasoning about not depending on searchParams).
  useEffect(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (filter === 'all') next.delete('filter')
      else next.set('filter', filter)
      if (search) next.set('search', search)
      else next.delete('search')
      return next
    }, { replace: true })
  }, [filter, search, setSearchParams])

  const fetchUsers = useCallback(async ({ append = false, offset = 0 } = {}) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    try {
      const params = new URLSearchParams({
        filter,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      if (search) params.set('search', search)
      const res = await fetch(`/api/admin/users?${params}`, {
        credentials: 'include',
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setUsers(prev => append ? [...prev, ...(data.users || [])] : (data.users || []))
      setTotal(data.total || 0)
      setHasMore(!!data.hasMore)
    } catch (err) {
      toast.error(`Failed to load users: ${err.message}`)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [filter, search, toast])

  // Refetch from offset 0 whenever filter/search change. Pagination
  // resets in lockstep.
  useEffect(() => { fetchUsers({ append: false, offset: 0 }) }, [fetchUsers])

  const loadMore = () => {
    fetchUsers({ append: true, offset: users.length })
  }

  const submitSearch = (e) => {
    e.preventDefault()
    setSearch(searchInput.trim())
  }

  const requestBan = (user, is_banned) => setBanConfirm({ user, is_banned })

  const confirmBan = async () => {
    if (!banConfirm) return
    const { user, is_banned } = banConfirm
    setBanConfirm(null)
    setActingId(user.id)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        credentials: 'include',
        body: JSON.stringify({ id: user.id, is_banned }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.code === 'STALE_SESSION') throw new Error('Sign in again before banning users.')
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      toast.success(`@${user.username || user.id} ${is_banned ? 'banned' : 'unbanned'}`)
      fetchUsers()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setActingId(null)
    }
  }

  const subtitle = useMemo(() => {
    const f = FILTER_CHIPS.find(c => c.value === filter)?.label || 'All'
    const userWord = total === 1 ? 'user' : 'users'
    return `${total} ${userWord} · ${f}${search ? ` · matching "${search}"` : ''}`
  }, [filter, search, total])

  return (
    <AdminLayout title="Users" subtitle={subtitle}>
      <div className="admin-users">
        <div className="admin-users-toolbar">
          <div className="admin-users-filters" role="group" aria-label="Filter users">
            {FILTER_CHIPS.map(chip => (
              <button
                key={chip.value}
                type="button"
                className={`admin-users-chip ${filter === chip.value ? 'active' : ''}`}
                onClick={() => setFilter(chip.value)}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <form className="admin-users-search" onSubmit={submitSearch}>
            <input
              type="search"
              placeholder="Search username or email…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              aria-label="Search users"
            />
            <button type="submit">Search</button>
          </form>
        </div>

        {loading ? (
          <p className="admin-users-loading">Loading…</p>
        ) : users.length === 0 ? (
          <p className="admin-users-empty">No users match those filters.</p>
        ) : (
          <>
            <ul className="admin-users-list">
              {users.map(u => (
                <UserRow
                  key={u.id}
                  user={u}
                  acting={actingId === u.id}
                  onBan={() => requestBan(u, true)}
                  onUnban={() => requestBan(u, false)}
                />
              ))}
            </ul>
            {hasMore && (
              <div className="admin-users-loadmore">
                <button
                  type="button"
                  className="admin-users-btn admin-users-btn-secondary"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading…' : `Load more (${total - users.length} remaining)`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={!!banConfirm}
        title={banConfirm?.is_banned ? `Ban @${banConfirm.user.username || banConfirm.user.id}?` : `Unban @${banConfirm?.user.username || banConfirm?.user.id}?`}
        message={banConfirm?.is_banned
          ? 'They will not be able to sign in. This action is reversible from this page.'
          : 'They will be able to sign in again.'}
        confirmLabel={banConfirm?.is_banned ? 'Ban user' : 'Unban user'}
        destructive={banConfirm?.is_banned}
        onConfirm={confirmBan}
        onCancel={() => setBanConfirm(null)}
      />
    </AdminLayout>
  )
}

function UserRow({ user, acting, onBan, onUnban }) {
  const premium = user.tier === 'premium' && (!user.subscription_expires_at || new Date(user.subscription_expires_at) > new Date())
  const cancelled = !!user.subscription_cancelled_at
  return (
    <li className={`admin-users-row ${user.is_banned ? 'admin-users-row-banned' : ''}`}>
      <div className="admin-users-row-id">
        {user.avatar_url ? (
          <img src={user.avatar_url} alt="" className="admin-users-avatar" />
        ) : (
          <div className="admin-users-avatar admin-users-avatar-placeholder" aria-hidden="true">
            {(user.username || user.email || '?').charAt(0).toUpperCase()}
          </div>
        )}
        <div className="admin-users-id-text">
          <div className="admin-users-username">
            <strong>@{user.username || '—'}</strong>
            {user.is_admin && <span className="admin-users-badge admin-users-badge-admin">admin</span>}
            {premium && <span className="admin-users-badge admin-users-badge-premium">ROAM+</span>}
            {cancelled && premium && <span className="admin-users-badge admin-users-badge-cancelling">cancelling</span>}
            {user.is_banned && <span className="admin-users-badge admin-users-badge-banned">banned</span>}
          </div>
          <div className="admin-users-display">{user.display_name || ''}</div>
          <div className="admin-users-email">{user.email}</div>
        </div>
      </div>

      <div className="admin-users-row-stats">
        <Stat label="Swipes" value={user.total_swipes ?? 0} />
        <Stat label="Saved" value={user.places_saved ?? 0} />
        <Stat label="Visited" value={user.places_visited ?? 0} />
        <Stat label="Streak" value={user.current_streak ?? 0} />
      </div>

      <div className="admin-users-row-meta">
        <div><strong>Joined:</strong> {formatDate(user.created_at)}</div>
        <div><strong>Last login:</strong> {timeSince(user.last_login_at)}</div>
        {user.subscription_source && (
          <div><strong>Sub source:</strong> {user.subscription_source}</div>
        )}
        {user.subscription_expires_at && premium && (
          <div><strong>Renews:</strong> {formatDate(user.subscription_expires_at)}</div>
        )}
      </div>

      <div className="admin-users-row-actions">
        {user.username && (
          <Link to={`/user/${user.username}`} className="admin-users-btn admin-users-btn-secondary" target="_blank" rel="noopener noreferrer">
            View profile ↗
          </Link>
        )}
        {user.is_banned ? (
          <button
            type="button"
            className="admin-users-btn admin-users-btn-primary"
            disabled={acting}
            onClick={onUnban}
          >
            Unban
          </button>
        ) : (
          !user.is_admin && (
            <button
              type="button"
              className="admin-users-btn admin-users-btn-destructive"
              disabled={acting}
              onClick={onBan}
            >
              Ban
            </button>
          )
        )}
      </div>
    </li>
  )
}

function Stat({ label, value }) {
  return (
    <div className="admin-users-stat">
      <span className="admin-users-stat-value">{Number(value || 0).toLocaleString('en-GB')}</span>
      <span className="admin-users-stat-label">{label}</span>
    </div>
  )
}

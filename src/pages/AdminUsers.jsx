/**
 * AdminUsers: browse, ban and delete accounts.
 *
 * URL params (read on mount, kept in sync):
 *   ?filter=all|premium|new|banned|inactive|test
 *   ?search=<text>
 *
 * 'Likely test accounts' is a server-side filter (throwaway-looking
 * emails or usernames, or week-old accounts with zero activity) so the
 * owner can find and remove test sign-ups fast. Deleting needs the
 * username typed out; the API enforces the same rule plus fresh login,
 * not self and not an admin. The API is the real gate throughout.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../contexts/AuthContext'
import ConfirmModal from '../components/ConfirmModal'
import AdminLayout from '../components/AdminLayout'
import AdminStatus from '../components/AdminStatus'
import { timeAgo, formatDate } from '../components/adminFormat'
import './AdminUsers.css'
import { authHeaders } from '../utils/authToken'

const FILTER_CHIPS = [
  { value: 'all', label: 'All' },
  { value: 'premium', label: 'ROAM+' },
  { value: 'new', label: 'New, 30 days' },
  { value: 'inactive', label: 'Inactive, 30 days' },
  { value: 'banned', label: 'Banned' },
  { value: 'test', label: 'Likely test accounts' },
]

const PAGE_SIZE = 50

// What the admin must type to confirm a delete; mirrors the API.
const confirmPhrase = (u) => u?.username || u?.email || ''

export default function AdminUsers() {
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()
  const { user: me } = useAuth()

  const initialFilter = FILTER_CHIPS.some((c) => c.value === searchParams.get('filter')) ? searchParams.get('filter') : 'all'
  const initialSearch = searchParams.get('search') || ''

  const [filter, setFilter] = useState(initialFilter)
  const [searchInput, setSearchInput] = useState(initialSearch)
  const [search, setSearch] = useState(initialSearch)
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [actingId, setActingId] = useState(null)
  const [banConfirm, setBanConfirm] = useState(null) // { user, is_banned }
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [typed, setTyped] = useState('')

  useEffect(() => {
    setSearchParams((prev) => {
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
    else { setLoading(true); setError(null) }
    try {
      const params = new URLSearchParams({ filter, limit: String(PAGE_SIZE), offset: String(offset) })
      if (search) params.set('search', search)
      const res = await fetch(`/api/admin/users?${params}`, { credentials: 'include', headers: authHeaders() })
      if (!res.ok) throw new Error(`The server answered ${res.status}`)
      const data = await res.json()
      setUsers((prev) => (append ? [...prev, ...(data.users || [])] : (data.users || [])))
      setTotal(data.total || 0)
      setHasMore(!!data.hasMore)
    } catch (err) {
      if (append) toast.error(`Couldn't load more users: ${err.message}`)
      else setError(err.message || 'Network error')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [filter, search, toast])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const submitSearch = (e) => {
    e.preventDefault()
    setSearch(searchInput.trim())
  }

  const mutate = async (method, body, user, successMsg) => {
    setActingId(user.id)
    try {
      const res = await fetch('/api/admin/users', {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.code === 'STALE_SESSION') throw new Error('Sign in again, then retry. Account changes need a login from the last 30 minutes.')
        throw new Error(data.error || `The server answered ${res.status}`)
      }
      toast.success(successMsg)
      fetchUsers()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setActingId(null)
    }
  }

  const confirmBan = () => {
    if (!banConfirm) return
    const { user, is_banned } = banConfirm
    setBanConfirm(null)
    mutate('PATCH', { id: user.id, is_banned }, user, `@${user.username || user.id} ${is_banned ? 'banned' : 'unbanned'}`)
  }

  const confirmDelete = () => {
    if (!deleteTarget || typed !== confirmPhrase(deleteTarget)) return
    const user = deleteTarget
    setDeleteTarget(null)
    setTyped('')
    mutate('DELETE', { id: user.id, confirm: confirmPhrase(user) }, user, `Account ${user.username ? `@${user.username}` : user.email} deleted`)
  }

  const subtitle = useMemo(() => {
    const f = FILTER_CHIPS.find((c) => c.value === filter)?.label || 'All'
    return `${total.toLocaleString('en-GB')} ${total === 1 ? 'account' : 'accounts'} · ${f}${search ? ` · matching "${search}"` : ''}`
  }, [filter, search, total])

  const phrase = confirmPhrase(deleteTarget)

  return (
    <AdminLayout title="Users" subtitle={subtitle}>
      <div className="admin-toolbar">
        <div className="admin-chips" role="group" aria-label="Filter users">
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              className={`chip${filter === chip.value ? ' selected' : ''}`}
              aria-pressed={filter === chip.value}
              onClick={() => setFilter(chip.value)}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <form className="admin-search" role="search" onSubmit={submitSearch}>
          <input
            type="search"
            placeholder="Search username or email"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search users"
          />
          <button type="submit" className="btn btn-secondary btn-sm">Search</button>
        </form>
      </div>

      {filter === 'test' && !loading && !error && (
        <p className="admin-users-note">
          Accounts with test, demo, example or mailinator in the email or username, plus accounts over a week old that never swiped, saved or visited. Check each one before deleting.
        </p>
      )}

      <AdminStatus
        loading={loading}
        error={error}
        onRetry={() => fetchUsers()}
        empty={users.length === 0}
        emptyTitle={filter === 'test' ? 'No likely test accounts' : 'No users match'}
        emptyText={search ? 'Try a shorter search or another filter.' : 'Try another filter.'}
      >
        <div className="admin-table-wrap">
          <table className="admin-table admin-users-table">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col" className="num">Swipes</th>
                <th scope="col" className="num">Saved</th>
                <th scope="col" className="num">Visited</th>
                <th scope="col">Joined</th>
                <th scope="col">Last login</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  isSelf={me?.id === u.id}
                  acting={actingId === u.id}
                  onBan={() => setBanConfirm({ user: u, is_banned: true })}
                  onUnban={() => setBanConfirm({ user: u, is_banned: false })}
                  onDelete={() => { setTyped(''); setDeleteTarget(u) }}
                />
              ))}
            </tbody>
          </table>
        </div>
        <div className="admin-pager">
          <span>Showing {users.length.toLocaleString('en-GB')} of {total.toLocaleString('en-GB')}</span>
          {hasMore && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fetchUsers({ append: true, offset: users.length })} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </AdminStatus>

      <ConfirmModal
        isOpen={!!banConfirm}
        title={`${banConfirm?.is_banned ? 'Ban' : 'Unban'} @${banConfirm?.user.username || banConfirm?.user.id}?`}
        message={banConfirm?.is_banned
          ? 'They will not be able to sign in. You can unban them from this page.'
          : 'They will be able to sign in again.'}
        confirmLabel={banConfirm?.is_banned ? 'Ban user' : 'Unban user'}
        destructive={banConfirm?.is_banned}
        onConfirm={confirmBan}
        onCancel={() => setBanConfirm(null)}
      />

      <ConfirmModal
        isOpen={!!deleteTarget}
        title="Delete this account?"
        message={
          <div className="admin-typed-confirm">
            <span>
              This permanently deletes {deleteTarget?.username ? `@${deleteTarget.username}` : 'this account'}, their saves, visits, reviews and photos, and cancels any Stripe subscription. It can't be undone.
            </span>
            <label htmlFor="admin-delete-confirm">Type <code>{phrase}</code> to confirm</label>
            <input
              id="admin-delete-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmDelete() }}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-invalid={typed.length > 0 && typed !== phrase}
            />
          </div>
        }
        confirmLabel={typed === phrase ? 'Delete account' : 'Type the name first'}
        destructive
        onConfirm={confirmDelete}
        onCancel={() => { setDeleteTarget(null); setTyped('') }}
      />
    </AdminLayout>
  )
}

function UserRow({ user, isSelf, acting, onBan, onUnban, onDelete }) {
  const premium = user.tier === 'premium' && (!user.subscription_expires_at || new Date(user.subscription_expires_at) > new Date())
  const protectedAccount = !!user.is_admin || isSelf
  return (
    <tr className={user.is_banned ? 'is-banned' : ''}>
      <td>
        <div className="admin-users-id">
          {user.avatar_url ? (
            <img src={user.avatar_url} alt="" className="admin-users-avatar" loading="lazy" />
          ) : (
            <span className="admin-users-avatar admin-users-avatar-placeholder" aria-hidden="true">
              {(user.username || user.email || '?').charAt(0).toUpperCase()}
            </span>
          )}
          <div className="admin-users-idtext">
            <div className="admin-users-name">
              <strong>{user.username ? `@${user.username}` : user.display_name || 'No username'}</strong>
              {!!user.is_admin && <span className="admin-badge admin-badge-brand">Admin</span>}
              {premium && <span className="admin-badge admin-badge-ok">ROAM+</span>}
              {premium && user.subscription_cancelled_at && <span className="admin-badge admin-badge-warn">Cancelling</span>}
              {!!user.is_banned && <span className="admin-badge admin-badge-danger">Banned</span>}
            </div>
            <div className="admin-users-email">{user.email}</div>
          </div>
        </div>
      </td>
      <td className="num" data-label="Swipes">{Number(user.total_swipes || 0).toLocaleString('en-GB')}</td>
      <td className="num" data-label="Saved">{Number(user.places_saved || 0).toLocaleString('en-GB')}</td>
      <td className="num" data-label="Visited">{Number(user.places_visited || 0).toLocaleString('en-GB')}</td>
      <td data-label="Joined" title={formatDate(user.created_at)}>{timeAgo(user.created_at)}</td>
      <td data-label="Last login">{timeAgo(user.last_login_at)}</td>
      <td>
        <div className="admin-users-actions">
        {user.username && (
          <Link to={`/user/${user.username}`} className="btn btn-secondary btn-sm" target="_blank" rel="noopener noreferrer">
            Profile
          </Link>
        )}
        {user.is_banned ? (
          <button type="button" className="btn btn-secondary btn-sm" disabled={acting} onClick={onUnban}>Unban</button>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm" disabled={acting || protectedAccount} onClick={onBan}>Ban</button>
        )}
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={acting || protectedAccount}
          title={protectedAccount ? (isSelf ? "You can't delete your own account here" : "Admins can't be deleted") : undefined}
          onClick={onDelete}
        >
          Delete account
        </button>
      </div>
      </td>
    </tr>
  )
}

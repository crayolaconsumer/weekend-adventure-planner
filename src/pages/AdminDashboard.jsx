/**
 * AdminDashboard — operator landing page at /admin.
 *
 * Surfaces high-signal counts so you can triage at a glance (how many
 * reports need attention, how many campaigns are live, recent ad
 * activity, user growth) and links out to the sub-tools that actually
 * let you do something about it.
 *
 * Every stat card is also a click-through to a drill-down page, so the
 * dashboard isn't just a read-only summary — it's the way you navigate
 * into the rest of the admin tool. The "Recently" footer block surfaces
 * the last few admin actions so you can see what you (or another
 * operator) most recently changed.
 *
 * All numeric data comes from /api/admin/dashboard in a single round
 * trip; the recent-activity strip comes from /api/admin/activity?limit=5.
 *
 * Route is gated by AdminRoute (mirrors /admin/reports + /admin/campaigns).
 */

import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../hooks/useToast'
import AdminLayout from '../components/AdminLayout'
import './AdminDashboard.css'

function authHeaders() {
  const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function formatPounds(pence) {
  if (typeof pence !== 'number') return '£0.00'
  return `£${(pence / 100).toFixed(2)}`
}

function formatNumber(n) {
  if (typeof n !== 'number') return '0'
  return n.toLocaleString('en-GB')
}

function timeAgo(timestamp) {
  if (!timestamp) return ''
  const now = Date.now()
  const then = new Date(timestamp).getTime()
  const diff = Math.max(0, now - then) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(timestamp).toLocaleDateString('en-GB')
}

// Map an admin_actions.action string into a sentence that means
// something to a human scanning the recent-activity strip.
//
// For report.* actions, target_id is the reported entity id (a
// contribution, review, photo, etc.). The id of the user who got
// banned via that report is stored in metadata.reportedUserId by
// api/admin/reports.js. Using target_id for "banned user #N" would
// falsely accuse the entity id of being a user account.
function describeAction(row) {
  const action = row.action || ''
  const targetType = row.target_type || ''
  const targetId = row.target_id || ''
  const reportedUserId = row.metadata?.reportedUserId

  if (action.startsWith('report.dismiss')) return `dismissed report on ${targetType} #${targetId}`
  if (action.startsWith('report.review')) return `marked review on ${targetType} #${targetId}`
  if (action.startsWith('report.action.hide_content')) return `hid contribution #${targetId}`
  if (action.startsWith('report.action.hide_review')) return `hid review text on rating #${targetId}`
  if (action.startsWith('report.action.ban_user')) {
    const bannedId = reportedUserId ?? targetId
    return `banned user #${bannedId}`
  }
  if (action.startsWith('report.')) return `actioned report on ${targetType} #${targetId}`
  if (action.startsWith('campaign.create')) return `created campaign #${targetId}`
  if (action.startsWith('campaign.update')) return `updated campaign #${targetId}`
  if (action.startsWith('campaign.cancel')) return `cancelled campaign #${targetId}`
  if (action.startsWith('user.ban')) return `banned user #${targetId}`
  if (action.startsWith('user.unban')) return `unbanned user #${targetId}`
  return `${action} on ${targetType || 'something'} #${targetId}`
}

export default function AdminDashboard() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [dashRes, recentRes] = await Promise.all([
        fetch('/api/admin/dashboard', { credentials: 'include', headers: authHeaders() }),
        // Recently-activity strip — best-effort, doesn't block the dashboard.
        fetch('/api/admin/activity?limit=5', { credentials: 'include', headers: authHeaders() })
          .catch(() => null),
      ])

      if (!dashRes.ok) throw new Error(`HTTP ${dashRes.status}`)
      const dashJson = await dashRes.json()
      setData(dashJson)

      if (recentRes && recentRes.ok) {
        const recentJson = await recentRes.json()
        setRecent(recentJson.actions || [])
      } else {
        setRecent([])
      }
    } catch (err) {
      toast.error(`Failed to load dashboard: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  return (
    <AdminLayout title="ROAM Admin" subtitle="Operator dashboard">
      <div className="admin-dashboard">
        {loading && !data ? (
          <p className="admin-dashboard-loading">Loading…</p>
        ) : (
          <>
            <section className="admin-dashboard-statgrid">
              <Stat
                label="Open reports"
                value={formatNumber(data?.reports?.open)}
                to="/admin/reports"
                accent={data?.reports?.critical_open > 0 ? 'danger' : data?.reports?.open > 0 ? 'warning' : 'ok'}
                hint={
                  data?.reports?.critical_open > 0
                    ? `${data.reports.critical_open} critical`
                    : data?.reports?.high_open > 0
                      ? `${data.reports.high_open} high`
                      : data?.reports?.open === 0
                        ? 'Inbox zero'
                        : 'Untriaged'
                }
              />
              <Stat
                label="Active campaigns"
                value={formatNumber(data?.campaigns?.active)}
                to="/admin/campaigns"
                hint={
                  data?.campaigns?.draft > 0
                    ? `${data.campaigns.draft} draft, ${data?.campaigns?.paused ?? 0} paused`
                    : data?.campaigns?.paused > 0
                      ? `${data.campaigns.paused} paused`
                      : 'None pending'
                }
              />
              <Stat
                label="Ad spend (lifetime)"
                value={formatPounds(data?.campaigns?.lifetime_spent_pence)}
                to="/admin/campaigns"
                hint={`${formatNumber(data?.campaigns?.lifetime_impressions)} impressions · ${formatNumber(data?.campaigns?.lifetime_clicks)} clicks`}
              />
              <Stat
                label="Impressions (7 days)"
                value={formatNumber(data?.ads?.impressions_7d)}
                to="/admin/ads?range=7d"
                hint={`${formatNumber(data?.ads?.clicks_7d)} clicks · ${formatNumber(data?.ads?.saves_7d)} saves`}
              />
              <Stat
                label="Premium users"
                value={formatNumber(data?.users?.premium)}
                to="/admin/users?filter=premium"
                hint={data?.users?.total ? `of ${formatNumber(data.users.total)} total` : null}
              />
              <Stat
                label="New users (30d)"
                value={formatNumber(data?.users?.new_30d)}
                to="/admin/users?filter=new"
                hint={data?.users?.banned ? `${data.users.banned} banned` : 'No bans'}
              />
            </section>

            <section className="admin-dashboard-tools">
              <h2>Tools</h2>
              <div className="admin-dashboard-toolgrid">
                <ToolCard
                  to="/admin/reports"
                  title="Reports"
                  description="Triage user-submitted reports of abusive content."
                  count={data?.reports?.open}
                  countLabel="open"
                  accent={data?.reports?.critical_open > 0 ? 'danger' : data?.reports?.open > 0 ? 'warning' : null}
                />
                <ToolCard
                  to="/admin/campaigns"
                  title="Sponsored campaigns"
                  description="Create and manage promoted-place campaigns for local businesses."
                  count={data?.campaigns?.active}
                  countLabel="active"
                />
                <ToolCard
                  to="/admin/users"
                  title="Users"
                  description="Browse signed-up users, view engagement stats, and manage bans."
                  count={data?.users?.total}
                  countLabel="total"
                />
                <ToolCard
                  to="/admin/ads"
                  title="Ad analytics"
                  description="Impressions, clicks, conversions, and per-campaign performance."
                  count={data?.ads?.impressions_7d}
                  countLabel="last 7d"
                />
                <ToolCard
                  to="/admin/activity"
                  title="Audit log"
                  description="Chronological record of every admin action — yours and any other operator's."
                  count={data?.audit?.actions_7d}
                  countLabel="last 7d"
                />
              </div>
            </section>

            {recent.length > 0 && (
              <section className="admin-dashboard-recent">
                <div className="admin-dashboard-recent-head">
                  <h2>Recently</h2>
                  <Link to="/admin/activity" className="admin-dashboard-recent-more">View all →</Link>
                </div>
                <ul className="admin-dashboard-recent-list">
                  {recent.map(row => (
                    <li key={row.id} className="admin-dashboard-recent-row">
                      <span className="admin-dashboard-recent-actor">
                        @{row.admin_username || `admin ${row.admin_id}`}
                      </span>
                      <span className="admin-dashboard-recent-text">{describeAction(row)}</span>
                      <span className="admin-dashboard-recent-time">{timeAgo(row.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="admin-dashboard-tools admin-dashboard-tools-muted">
              <h2>External dashboards</h2>
              <div className="admin-dashboard-toolgrid">
                <ExternalCard
                  href="https://admob.google.com"
                  title="Google AdMob"
                  description="Mobile ad performance, payouts, and ad unit management."
                />
                <ExternalCard
                  href="https://www.google.com/adsense"
                  title="Google AdSense"
                  description="Web banner performance and policy notices."
                />
                <ExternalCard
                  href="https://vercel.com/james-fittons-projects/weekend-adventure-planner"
                  title="Vercel"
                  description="Deployments, build logs, environment variables."
                />
                <ExternalCard
                  href="https://app.revenuecat.com"
                  title="RevenueCat"
                  description="ROAM+ subscription analytics and entitlement state."
                />
              </div>
            </section>
          </>
        )}
      </div>
    </AdminLayout>
  )
}

function Stat({ label, value, hint, accent, to }) {
  const inner = (
    <>
      <span className="admin-dashboard-stat-label">{label}</span>
      <strong className="admin-dashboard-stat-value">{value}</strong>
      {hint && <span className="admin-dashboard-stat-hint">{hint}</span>}
    </>
  )
  const className = `admin-dashboard-stat${accent ? ` admin-dashboard-stat-${accent}` : ''}${to ? ' admin-dashboard-stat-link' : ''}`

  if (to) {
    return (
      <Link to={to} className={className}>
        {inner}
        <span className="admin-dashboard-stat-arrow" aria-hidden="true">→</span>
      </Link>
    )
  }
  return <div className={className}>{inner}</div>
}

function ToolCard({ to, title, description, count, countLabel, accent }) {
  return (
    <Link to={to} className={`admin-dashboard-tool${accent ? ` admin-dashboard-tool-${accent}` : ''}`}>
      <div className="admin-dashboard-tool-head">
        <h3>{title}</h3>
        {count != null && (
          <span className={`admin-dashboard-tool-count${accent ? ` admin-dashboard-tool-count-${accent}` : ''}`}>
            {formatNumber(count)} <span>{countLabel}</span>
          </span>
        )}
      </div>
      <p>{description}</p>
      <span className="admin-dashboard-tool-cta">Open →</span>
    </Link>
  )
}

function ExternalCard({ href, title, description }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="admin-dashboard-tool admin-dashboard-tool-external"
    >
      <div className="admin-dashboard-tool-head">
        <h3>{title}</h3>
        <span className="admin-dashboard-tool-external-icon" aria-hidden="true">↗</span>
      </div>
      <p>{description}</p>
    </a>
  )
}

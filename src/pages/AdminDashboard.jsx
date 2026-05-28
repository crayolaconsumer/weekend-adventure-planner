/**
 * AdminDashboard — operator landing page at /admin.
 *
 * Surfaces high-signal counts so you can triage at a glance (how many
 * reports need attention, how many campaigns are live, recent ad
 * activity, user growth) and links out to the sub-tools that actually
 * let you do something about it.
 *
 * The route is gated by AdminRoute (mirrors /admin/reports +
 * /admin/campaigns). All data comes from /api/admin/dashboard in a
 * single round-trip.
 */

import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../hooks/useToast'
import './AdminDashboard.css'

function authHeaders() {
  const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function formatPounds(pence) {
  if (typeof pence !== 'number') return '£0'
  return `£${(pence / 100).toFixed(2)}`
}

function formatNumber(n) {
  if (typeof n !== 'number') return '0'
  return n.toLocaleString('en-GB')
}

export default function AdminDashboard() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/dashboard', {
        credentials: 'include',
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (err) {
      toast.error(`Failed to load dashboard: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  return (
    <div className="admin-dashboard">
      <header className="admin-dashboard-header">
        <h1>ROAM Admin</h1>
        <p className="admin-dashboard-subtitle">Operator dashboard</p>
      </header>

      {loading && !data ? (
        <p className="admin-dashboard-loading">Loading…</p>
      ) : (
        <>
          <section className="admin-dashboard-statgrid">
            <Stat
              label="Open reports"
              value={formatNumber(data?.reports?.open)}
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
              hint={`${formatNumber(data?.campaigns?.lifetime_impressions)} impressions / ${formatNumber(data?.campaigns?.lifetime_clicks)} clicks`}
            />
            <Stat
              label="Impressions (7 days)"
              value={formatNumber(data?.ads?.impressions_7d)}
              hint={`${formatNumber(data?.ads?.clicks_7d)} clicks · ${formatNumber(data?.ads?.saves_7d)} saves`}
            />
            <Stat
              label="Premium users"
              value={formatNumber(data?.users?.premium)}
              hint={data?.users?.total ? `of ${formatNumber(data.users.total)} total` : null}
            />
            <Stat
              label="New users (30d)"
              value={formatNumber(data?.users?.new_30d)}
              hint={data?.users?.banned ? `${data.users.banned} banned` : null}
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
                countLabel={data?.reports?.open === 1 ? 'open' : 'open'}
                accent={data?.reports?.critical_open > 0 ? 'danger' : data?.reports?.open > 0 ? 'warning' : null}
              />
              <ToolCard
                to="/admin/campaigns"
                title="Sponsored campaigns"
                description="Create and manage promoted-place campaigns for local businesses."
                count={data?.campaigns?.active}
                countLabel={data?.campaigns?.active === 1 ? 'active' : 'active'}
              />
            </div>
          </section>

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
  )
}

function Stat({ label, value, hint, accent }) {
  return (
    <div className={`admin-dashboard-stat${accent ? ` admin-dashboard-stat-${accent}` : ''}`}>
      <span className="admin-dashboard-stat-label">{label}</span>
      <strong className="admin-dashboard-stat-value">{value}</strong>
      {hint && <span className="admin-dashboard-stat-hint">{hint}</span>}
    </div>
  )
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

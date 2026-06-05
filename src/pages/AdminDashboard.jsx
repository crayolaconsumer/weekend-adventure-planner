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

// Runtime kill-switches surfaced in the dashboard. Keys MUST match
// api/lib/flags.js DEFAULTS + api/admin/flags.js.
const FLAG_META = [
  { key: 'overpassProxy', label: 'Overpass proxy (live POI)', desc: 'OFF → serve cached/stale Discover only, zero live upstream calls. Sheds Overpass load / cost.' },
  { key: 'contributionsUpload', label: 'Photo uploads', desc: 'OFF → reject new contribution photo uploads (abuse / storage-cost control).' },
  { key: 'pushNudges', label: 'Marketing push nudges', desc: 'OFF → pause re-engagement + weekend nudge crons. (Visit reminders unaffected.)' },
  { key: 'discover', label: 'Discover (client gate)', desc: 'Client-read flag to disable the Discover deck app-side; consumed from the next app build.' },
]

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
  const [health, setHealth] = useState(null)
  const [flags, setFlags] = useState(null)
  const [flagBusy, setFlagBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [dashRes, recentRes, healthRes, flagsRes] = await Promise.all([
        fetch('/api/admin/dashboard', { credentials: 'include', headers: authHeaders() }),
        // Recently-activity strip — best-effort, doesn't block the dashboard.
        fetch('/api/admin/activity?limit=5', { credentials: 'include', headers: authHeaders() })
          .catch(() => null),
        // System health + feature flags — best-effort, never block the page.
        fetch('/api/health').catch(() => null),
        fetch('/api/admin/flags', { credentials: 'include', headers: authHeaders() }).catch(() => null),
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

      // /api/health returns 503 when degraded — still parse the body for it.
      if (healthRes) {
        try { setHealth(await healthRes.json()) } catch { setHealth({ status: 'degraded', db: 'fail', kv: 'fail' }) }
      }
      if (flagsRes && flagsRes.ok) {
        try { setFlags((await flagsRes.json()).flags) } catch { /* leave null */ }
      }
    } catch (err) {
      toast.error(`Failed to load dashboard: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [toast])

  const toggleFlag = useCallback(async (name) => {
    if (!flags || flagBusy) return
    const desired = !flags[name]
    const before = flags
    setFlags({ ...flags, [name]: desired }) // optimistic
    setFlagBusy(true)
    try {
      const res = await fetch('/api/admin/flags', {
        method: 'POST',
        credentials: 'include',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ flags: { [name]: desired } }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setFlags(json.flags)
      toast.success(`${name} ${desired ? 'enabled' : 'DISABLED'} — live within ~60s`)
    } catch (err) {
      setFlags(before) // revert
      toast.error(`Failed to update ${name}: ${err.message}`)
    } finally {
      setFlagBusy(false)
    }
  }, [flags, flagBusy, toast])

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
              <h2>System health &amp; controls</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '18px' }}>
                <HealthPill label="API" state={health ? (health.status === 'ok' ? 'ok' : 'bad') : 'unknown'} text={health ? (health.status === 'ok' ? 'Operational' : 'Degraded') : '—'} />
                <HealthPill label="Database" state={health?.db === 'ok' ? 'ok' : (health ? 'bad' : 'unknown')} text={health?.db || '—'} />
                <HealthPill label="Cache (KV)" state={health?.kv === 'ok' ? 'ok' : health?.kv === 'disabled' ? 'warn' : (health ? 'bad' : 'unknown')} text={health?.kv || '—'} />
                {health?.ts && <span style={{ alignSelf: 'center', fontSize: '12px', color: '#6b6b6b' }}>checked {timeAgo(health.ts)}</span>}
              </div>

              <h3 style={{ margin: '0 0 4px' }}>Feature kill-switches</h3>
              <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#6b6b6b' }}>
                Turn a feature OFF to shed load or stop abuse instantly — no deploy. Changes go live within ~60s. Everything defaults ON.
              </p>
              {flags ? (
                <div style={{ display: 'grid', gap: '8px' }}>
                  {FLAG_META.map(f => (
                    <FlagRow key={f.key} meta={f} on={flags[f.key] !== false} busy={flagBusy} onToggle={() => toggleFlag(f.key)} />
                  ))}
                </div>
              ) : (
                <p className="admin-dashboard-loading" style={{ fontSize: '13px' }}>Flags unavailable (KV off, or not signed in as admin).</p>
              )}
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
                  to="/admin/promoted-events"
                  title="Promoted events"
                  description="Moderate self-serve Featured events from venues & organisers."
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

const HEALTH_COLORS = { ok: '#1a7f4b', bad: '#b22d2d', warn: '#c87a2f', unknown: '#9b9b9b' }

function HealthPill({ label, state, text }) {
  const color = HEALTH_COLORS[state] || HEALTH_COLORS.unknown
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', border: '1px solid #e6e3d8', borderRadius: '8px', background: '#fff' }}>
      <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a3a2f' }}>{label}</span>
      <span style={{ fontSize: '12px', color, textTransform: 'capitalize' }}>{text}</span>
    </div>
  )
}

function FlagRow({ meta, on, busy, onToggle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 12px', border: `1px solid ${on ? '#e6e3d8' : '#e7c3c3'}`, borderRadius: '8px', background: on ? '#fff' : '#fcf3f3' }}>
      <div style={{ minWidth: 0 }}>
        <strong style={{ display: 'block', fontSize: '14px', color: '#1a3a2f' }}>
          {meta.label}{!on && <span style={{ color: '#b22d2d', fontWeight: 700 }}> · DISABLED</span>}
        </strong>
        <span style={{ fontSize: '12px', color: '#6b6b6b' }}>{meta.desc}</span>
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={on}
        style={{
          flexShrink: 0, minWidth: '64px', padding: '7px 14px', borderRadius: '999px', border: 'none',
          fontWeight: 700, fontSize: '13px', cursor: busy ? 'wait' : 'pointer',
          background: on ? '#1a7f4b' : '#b22d2d', color: '#fff', opacity: busy ? 0.6 : 1,
        }}
      >
        {on ? 'ON' : 'OFF'}
      </button>
    </div>
  )
}

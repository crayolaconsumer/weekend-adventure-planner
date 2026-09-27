/**
 * AdminDashboard: the owner's landing page at /admin.
 *
 * Key numbers first (users, growth, activity, money, moderation load),
 * then what needs attention, recent admin actions, system health with
 * the feature kill-switches, and links out to external dashboards.
 *
 * Numbers come from /api/admin/dashboard in one round trip; the recent
 * strip from /api/admin/activity?limit=6; health from /api/health.
 */

import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../hooks/useToast'
import AdminLayout from '../components/AdminLayout'
import AdminStatus from '../components/AdminStatus'
import { timeAgo, describeAction } from '../components/adminFormat'
import './AdminDashboard.css'
import { authHeaders } from '../utils/authToken'

// Runtime kill-switches. Keys MUST match api/lib/flags.js DEFAULTS and
// api/admin/flags.js.
const FLAG_META = [
  { key: 'overpassProxy', label: 'Overpass proxy (live places)', desc: 'Off serves cached Discover only, with no live upstream calls. Sheds Overpass load and cost.' },
  { key: 'contributionsUpload', label: 'Photo uploads', desc: 'Off rejects new contribution photo uploads (abuse or storage-cost control).' },
  { key: 'pushNudges', label: 'Marketing push nudges', desc: 'Off pauses the re-engagement and weekend nudge crons. Visit reminders are unaffected.' },
]
// Place database rollout, 0-100% of Discover/town requests. 0 is the kill switch.
const PCT_META = [
  { key: 'poiDbPct', label: 'Place database: serve', desc: 'Share of place lookups answered from our own database instead of Overpass.' },
  { key: 'poiShadowPct', label: 'Place database: shadow', desc: 'Share of Overpass answers also checked against our database (logged, never shown).' },
]

const EXTERNAL = [
  { href: 'https://app.revenuecat.com', title: 'RevenueCat', desc: 'ROAM+ subscriptions' },
  { href: 'https://admob.google.com', title: 'AdMob', desc: 'App ad revenue' },
  { href: 'https://www.google.com/adsense', title: 'AdSense', desc: 'Web ad revenue' },
  { href: 'https://vercel.com/james-fittons-projects/weekend-adventure-planner', title: 'Vercel', desc: 'Deploys and logs' },
]

const n = (v) => Number(v || 0).toLocaleString('en-GB')
const pounds = (pence) => `£${(Number(pence || 0) / 100).toFixed(2)}`

export default function AdminDashboard() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [health, setHealth] = useState(null)
  const [flags, setFlags] = useState(null)
  const [flagBusy, setFlagBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [dashRes, recentRes, healthRes, flagsRes] = await Promise.all([
        fetch('/api/admin/dashboard', { credentials: 'include', headers: authHeaders() }),
        fetch('/api/admin/activity?limit=6', { credentials: 'include', headers: authHeaders() }).catch(() => null),
        fetch('/api/health').catch(() => null),
        fetch('/api/admin/flags', { credentials: 'include', headers: authHeaders() }).catch(() => null),
      ])
      if (!dashRes.ok) throw new Error(`The server answered ${dashRes.status}`)
      setData(await dashRes.json())
      setRecent(recentRes?.ok ? ((await recentRes.json()).actions || []) : [])
      // /api/health answers 503 when degraded; the body still says why.
      if (healthRes) {
        try { setHealth(await healthRes.json()) } catch { setHealth({ status: 'degraded', db: 'fail', kv: 'fail' }) }
      }
      if (flagsRes?.ok) {
        try { setFlags((await flagsRes.json()).flags) } catch { /* leave null */ }
      }
    } catch (err) {
      setError(err.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const setFlag = useCallback(async (name, desired) => {
    if (!flags || flagBusy) return
    const before = flags
    setFlags({ ...flags, [name]: desired })
    setFlagBusy(true)
    try {
      const res = await fetch('/api/admin/flags', {
        method: 'POST',
        credentials: 'include',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ flags: { [name]: desired } }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setFlags((await res.json()).flags)
      const label = [...FLAG_META, ...PCT_META].find((f) => f.key === name)?.label || name
      const what = typeof desired === 'number' ? `set to ${desired}%` : `turned ${desired ? 'on' : 'off'}`
      toast.success(`${label} ${what}. Live within about a minute.`)
    } catch (err) {
      setFlags(before)
      toast.error(`Couldn't save that change: ${err.message}`)
    } finally {
      setFlagBusy(false)
    }
  }, [flags, flagBusy, toast])

  const r = data?.reports || {}
  const u = data?.users || {}
  const a = data?.activity || {}
  const c = data?.campaigns || {}

  const refresh = (
    <button type="button" className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
      {loading ? 'Refreshing…' : 'Refresh'}
    </button>
  )

  return (
    <AdminLayout title="Dashboard" subtitle="How ROAM is doing right now" actions={refresh}>
      <AdminStatus loading={loading && !data} error={!data && error} onRetry={load}>
        <div className="admin-dash">
          <section aria-labelledby="dash-key">
            <h2 id="dash-key" className="admin-dash-h2">Key numbers</h2>
            <div className="admin-dash-kpis">
              <Kpi label="Total users" value={n(u.total)} hint={`${n(u.banned)} banned`} to="/admin/users" />
              <Kpi label="New users, 7 days" value={n(u.new_7d)} hint={`${n(u.new_30d)} in 30 days`} to="/admin/users?filter=new" />
              <Kpi label="Active today" value={n(a.dau)} hint={`${n(a.wau)} this week`} />
              <Kpi label="ROAM+ members" value={n(u.premium)} hint={u.total ? `${((u.premium / u.total) * 100).toFixed(1)}% of users` : null} to="/admin/users?filter=premium" />
              <Kpi label="Places saved" value={n(a.saves)} hint="All time" />
              <Kpi label="Visits logged" value={n(a.visits)} hint="All time" />
              <Kpi
                label="Reports pending"
                value={n(r.open)}
                tone={r.critical_open > 0 ? 'danger' : r.open > 0 ? 'warn' : 'ok'}
                hint={r.critical_open > 0 ? `${n(r.critical_open)} critical` : r.high_open > 0 ? `${n(r.high_open)} high` : r.open ? 'None critical' : 'Inbox zero'}
                to="/admin/reports"
              />
              <Kpi
                label="Promoted live"
                value={n(c.active + (data?.promoted?.live || 0))}
                hint={`${n(c.active)} ${c.active === 1 ? 'campaign' : 'campaigns'} · ${n(data?.promoted?.live)} ${data?.promoted?.live === 1 ? 'event' : 'events'}`}
                to="/admin/campaigns"
              />
            </div>
          </section>

          <div className="admin-dash-cols">
            <section className="admin-dash-card" aria-labelledby="dash-recent">
              <div className="admin-dash-cardhead">
                <h2 id="dash-recent" className="admin-dash-h2">Recent admin actions</h2>
                <Link to="/admin/activity" className="admin-dash-more">Audit log</Link>
              </div>
              {recent.length === 0 ? (
                <p className="admin-muted admin-dash-empty">No admin actions yet. Bans, deletions and campaign changes will show here.</p>
              ) : (
                <ul className="admin-dash-recent">
                  {recent.map((row) => (
                    <li key={row.id}>
                      <span className="admin-dash-recent-text">
                        <strong>@{row.admin_username || `admin ${row.admin_id}`}</strong> {describeAction(row)}
                      </span>
                      <span className="admin-muted admin-dash-recent-time">{timeAgo(row.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="admin-dash-card" aria-labelledby="dash-money">
              <h2 id="dash-money" className="admin-dash-h2">Ads</h2>
              <dl className="admin-dash-dl">
                <div><dt>Impressions, 7 days</dt><dd>{n(data?.ads?.impressions_7d)}</dd></div>
                <div><dt>Clicks, 7 days</dt><dd>{n(data?.ads?.clicks_7d)}</dd></div>
                <div><dt>Campaign spend, lifetime</dt><dd>{pounds(c.lifetime_spent_pence)}</dd></div>
                <div><dt>Campaigns paused or draft</dt><dd>{n((c.paused || 0) + (c.draft || 0))}</dd></div>
              </dl>
              <Link to="/admin/ads" className="admin-dash-more">Ad analytics</Link>
            </section>
          </div>

          <section className="admin-dash-card" aria-labelledby="dash-health">
            <div className="admin-dash-cardhead">
              <h2 id="dash-health" className="admin-dash-h2">System health</h2>
              {health?.ts && <span className="admin-muted admin-dash-small">Checked {timeAgo(health.ts)}</span>}
            </div>
            <div className="admin-dash-health">
              <HealthPill label="API" state={health ? (health.status === 'ok' ? 'ok' : 'bad') : 'unknown'} text={health ? (health.status === 'ok' ? 'Operational' : 'Degraded') : 'Unknown'} />
              <HealthPill label="Database" state={health?.db === 'ok' ? 'ok' : (health ? 'bad' : 'unknown')} text={health?.db || 'Unknown'} />
              <HealthPill label="Cache" state={health?.kv === 'ok' ? 'ok' : health?.kv === 'disabled' ? 'warn' : (health ? 'bad' : 'unknown')} text={health?.kv || 'Unknown'} />
            </div>

            <h3 className="admin-dash-h3">Feature switches</h3>
            <p className="admin-muted admin-dash-small">Turn a feature off to shed load or stop abuse without a deploy. Changes go live within about a minute. Everything defaults to on.</p>
            {flags ? (
              <div className="admin-dash-flags">
                {FLAG_META.map((f) => (
                  <FlagRow key={f.key} meta={f} on={flags[f.key] !== false} busy={flagBusy} onToggle={() => setFlag(f.key, !flags[f.key])} />
                ))}
                {PCT_META.map((f) => (
                  <PctRow key={`${f.key}:${flags[f.key]}`} meta={f} value={Number(flags[f.key]) || 0} busy={flagBusy} onSave={(v) => setFlag(f.key, v)} />
                ))}
              </div>
            ) : (
              <p className="admin-muted admin-dash-small">Switches unavailable: the cache (KV) is off.</p>
            )}
          </section>

          <section aria-labelledby="dash-ext">
            <h2 id="dash-ext" className="admin-dash-h2">Elsewhere</h2>
            <div className="admin-dash-ext">
              {EXTERNAL.map((e) => (
                <a key={e.href} href={e.href} target="_blank" rel="noopener noreferrer" className="admin-dash-extlink">
                  <strong>{e.title} <span aria-hidden="true">↗</span></strong>
                  <span className="admin-muted">{e.desc}</span>
                </a>
              ))}
            </div>
          </section>
        </div>
      </AdminStatus>
    </AdminLayout>
  )
}

function Kpi({ label, value, hint, tone, to }) {
  const body = (
    <>
      <span className="admin-kpi-label">{label}</span>
      <strong className="admin-kpi-value">{value}</strong>
      {hint && <span className="admin-kpi-hint">{hint}</span>}
    </>
  )
  const cls = `admin-kpi${tone ? ` admin-kpi-${tone}` : ''}`
  return to ? <Link to={to} className={`${cls} admin-kpi-link`}>{body}</Link> : <div className={cls}>{body}</div>
}

function HealthPill({ label, state, text }) {
  return (
    <div className={`admin-health admin-health-${state}`}>
      <span className="admin-health-dot" aria-hidden="true" />
      <span className="admin-health-label">{label}</span>
      <span className="admin-health-text">{text}</span>
    </div>
  )
}

function PctRow({ meta, value, busy, onSave }) {
  const [draft, setDraft] = useState(String(value))
  const next = Number(draft)
  const ok = draft !== '' && Number.isInteger(next) && next >= 0 && next <= 100 && next !== value
  return (
    <form className="admin-flag" onSubmit={(e) => { e.preventDefault(); if (ok) onSave(next) }}>
      <div className="admin-flag-text">
        <strong>{meta.label}: {value}%</strong>
        <span className="admin-muted">{meta.desc}</span>
      </div>
      <input type="number" min="0" max="100" step="1" inputMode="numeric" value={draft}
        onChange={(e) => setDraft(e.target.value)} aria-label={`${meta.label} percent`} disabled={busy} style={{ width: '4.5em' }} />
      <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !ok}>Save</button>
    </form>
  )
}

function FlagRow({ meta, on, busy, onToggle }) {
  return (
    <div className={`admin-flag${on ? '' : ' is-off'}`}>
      <div className="admin-flag-text">
        <strong>{meta.label}{!on && <span className="admin-badge admin-badge-danger">Off</span>}</strong>
        <span className="admin-muted">{meta.desc}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={meta.label}
        className="admin-switch"
        onClick={onToggle}
        disabled={busy}
      >
        <span className="admin-switch-knob" />
      </button>
    </div>
  )
}

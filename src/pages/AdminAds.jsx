/**
 * AdminAds — analytics page for sponsored-place ad inventory.
 *
 * Drill-down target for the "Impressions (7 days)" card on the
 * dashboard. Shows summary tiles, per-campaign performance, a simple
 * daily-impressions bar chart, and the most-recent impression events
 * for whatever time range is selected.
 *
 * Empty state (current reality — no campaigns or impressions yet)
 * links straight to /admin/campaigns with a one-line nudge.
 */

import { useState, useEffect, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useToast } from '../hooks/useToast'
import AdminLayout from '../components/AdminLayout'
import './AdminAds.css'

const RANGES = [
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
]

function authHeaders() {
  const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function formatNumber(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '0'
  return n.toLocaleString('en-GB')
}

function formatPercent(p) {
  if (typeof p !== 'number' || Number.isNaN(p)) return '0%'
  return `${(p * 100).toFixed(1)}%`
}

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

function formatDateTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export default function AdminAds() {
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()
  const initialRange = RANGES.some(r => r.value === searchParams.get('range'))
    ? searchParams.get('range')
    : '7d'
  const [range, setRange] = useState(initialRange)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Write-only URL sync: must use the prev-callback form and exclude
    // searchParams from deps. Including searchParams would loop —
    // setSearchParams produces a new URLSearchParams object each call,
    // which would re-fire the effect, which would call setSearchParams
    // again, and so on.
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('range', range)
      return next
    }, { replace: true })
  }, [range, setSearchParams])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/ads?range=${range}`, {
        credentials: 'include',
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (err) {
      toast.error(`Failed to load ad analytics: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [range, toast])

  useEffect(() => { load() }, [load])

  const summary = data?.summary
  const campaigns = data?.by_campaign || []
  const series = data?.daily_series || []
  const events = data?.recent_events || []
  // Show the "no campaigns ever" empty state only when there have been
  // ZERO impressions across all time. A 24h or 7d window with no
  // impressions just means "quiet window" and should still render the
  // normal layout (with "No impressions in this range" messages where
  // each sub-section is empty).
  const isEmpty = summary && summary.impressions === 0 && range === 'all'

  return (
    <AdminLayout
      title="Ad analytics"
      subtitle={`Sponsored card performance · ${RANGES.find(r => r.value === range)?.label || ''}`}
      actions={
        <div className="admin-ads-rangepicker">
          {RANGES.map(r => (
            <button
              key={r.value}
              type="button"
              className={`admin-ads-range ${range === r.value ? 'active' : ''}`}
              onClick={() => setRange(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="admin-ads">
        {loading && !data ? (
          <p className="admin-ads-loading">Loading…</p>
        ) : isEmpty ? (
          <EmptyState />
        ) : (
          <>
            <section className="admin-ads-summary">
              <SummaryTile label="Impressions" value={formatNumber(summary?.impressions)} />
              <SummaryTile label="Unique users" value={formatNumber(summary?.unique_users)} />
              <SummaryTile label="Clicks" value={formatNumber(summary?.clicks)} />
              <SummaryTile label="CTR" value={formatPercent(summary?.ctr)} hint="click-through rate" />
              <SummaryTile label="Saves" value={formatNumber(summary?.saves)} hint="conversions" />
              <SummaryTile label="CVR" value={formatPercent(summary?.cvr)} hint="saves ÷ clicks" />
            </section>

            <section className="admin-ads-section">
              <h2>Impressions by day</h2>
              <DailyBarChart series={series} />
            </section>

            <section className="admin-ads-section">
              <h2>By campaign</h2>
              {campaigns.length === 0 ? (
                <p className="admin-ads-empty-mini">No campaign activity in this range.</p>
              ) : (
                <div className="admin-ads-tablewrap">
                  <table className="admin-ads-table">
                    <thead>
                      <tr>
                        <th>Campaign</th>
                        <th>Place</th>
                        <th>Business</th>
                        <th className="num">Impressions</th>
                        <th className="num">Clicks</th>
                        <th className="num">CTR</th>
                        <th className="num">Saves</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaigns.map(c => (
                        <tr key={c.sponsored_place_id}>
                          <td>{c.campaign_name || <em>untitled</em>}</td>
                          <td>{c.place_name || c.place_id}</td>
                          <td>{c.business_name || '—'}</td>
                          <td className="num">{formatNumber(c.impressions)}</td>
                          <td className="num">{formatNumber(c.clicks)}</td>
                          <td className="num">{formatPercent(c.ctr)}</td>
                          <td className="num">{formatNumber(c.saves)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="admin-ads-section">
              <h2>Recent activity</h2>
              {events.length === 0 ? (
                <p className="admin-ads-empty-mini">No impressions in this range.</p>
              ) : (
                <ul className="admin-ads-eventlist">
                  {events.map(e => (
                    <li key={e.id} className="admin-ads-event">
                      <span className="admin-ads-event-time">{formatDateTime(e.impressed_at)}</span>
                      <span className="admin-ads-event-text">
                        Impression — <strong>{e.campaign_name || 'untitled'}</strong>
                        {e.place_name && <> · {e.place_name}</>}
                        {e.business_name && <> · {e.business_name}</>}
                      </span>
                      <span className="admin-ads-event-tags">
                        {e.clicked && <span className="admin-ads-tag admin-ads-tag-click">clicked</span>}
                        {e.saved && <span className="admin-ads-tag admin-ads-tag-save">saved</span>}
                        {e.user_id ? (
                          <span className="admin-ads-tag">user #{e.user_id}</span>
                        ) : (
                          <span className="admin-ads-tag admin-ads-tag-anon">anonymous</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </AdminLayout>
  )
}

function SummaryTile({ label, value, hint }) {
  return (
    <div className="admin-ads-tile">
      <span className="admin-ads-tile-label">{label}</span>
      <strong className="admin-ads-tile-value">{value}</strong>
      {hint && <span className="admin-ads-tile-hint">{hint}</span>}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="admin-ads-emptystate">
      <h2>No ad impressions yet</h2>
      <p>
        Sponsored-place cards only render once you've created at least one active campaign.
      </p>
      <Link to="/admin/campaigns" className="admin-ads-emptystate-cta">
        Create a campaign →
      </Link>
    </div>
  )
}

// Minimal pure-SVG bar chart. No chart library, no dependencies.
function DailyBarChart({ series }) {
  if (!series || series.length === 0) {
    return <p className="admin-ads-empty-mini">No data for this range.</p>
  }

  const maxImpressions = Math.max(...series.map(s => s.impressions), 1)
  const barWidth = 100 / series.length
  const chartHeight = 140

  return (
    <div className="admin-ads-chart">
      <svg
        viewBox={`0 0 100 ${chartHeight}`}
        preserveAspectRatio="none"
        className="admin-ads-chart-svg"
        role="img"
        aria-label={`Daily impressions across ${series.length} days, max ${maxImpressions}`}
      >
        {series.map((d, i) => {
          const heightPct = (d.impressions / maxImpressions) * (chartHeight - 24)
          const x = i * barWidth + barWidth * 0.15
          const w = barWidth * 0.7
          const y = chartHeight - 16 - heightPct
          return (
            <g key={d.date}>
              <rect
                x={x}
                y={y}
                width={w}
                height={heightPct}
                fill="var(--roam-forest, #1a3a2f)"
                opacity="0.8"
              >
                <title>{`${d.date}: ${d.impressions} impressions, ${d.clicks} clicks`}</title>
              </rect>
            </g>
          )
        })}
      </svg>
      <div className="admin-ads-chart-axis">
        {series.map(d => (
          <span key={d.date} className="admin-ads-chart-tick" style={{ flexBasis: `${barWidth}%` }}>
            {formatDate(d.date)}
          </span>
        ))}
      </div>
    </div>
  )
}

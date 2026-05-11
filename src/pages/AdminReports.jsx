/**
 * AdminReports
 *
 * Operator-only queue for triaging UGC reports. Non-admins get a 404
 * screen so the page's existence isn't advertised. Real auth is in
 * /api/admin/reports — this frontend gate is advisory.
 *
 * Default view: open reports, ordered by AI severity (critical first).
 * Each row shows reporter, AI verdict, reported content, and three
 * primary actions: Dismiss / Hide content / Ban author. The fourth
 * action (Mark reviewed) is for "I looked but I'm not deciding yet".
 */

import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../hooks/useToast'
import './AdminReports.css'

const STATUS_FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'actioned', label: 'Actioned' },
]

const SEVERITY_FILTERS = [
  { value: null, label: 'All' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

function authHeaders() {
  const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export default function AdminReports() {
  const { user, loading: authLoading } = useAuth()
  const toast = useToast()
  const [status, setStatus] = useState('open')
  const [severity, setSeverity] = useState(null)
  const [reports, setReports] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState(null)

  const isAdmin = !!user?.isAdmin

  const fetchReports = useCallback(async () => {
    if (!isAdmin) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ status, limit: '50' })
      if (severity) params.set('severity', severity)
      const res = await fetch(`/api/admin/reports?${params}`, {
        credentials: 'include',
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setReports(data.reports || [])
      setTotal(data.total || 0)
    } catch (err) {
      toast.error(`Failed to load reports: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [isAdmin, status, severity, toast])

  useEffect(() => { fetchReports() }, [fetchReports])

  const decide = async (reportId, decision, actionTaken = 'none') => {
    setActing(reportId)
    try {
      const res = await fetch('/api/admin/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        credentials: 'include',
        body: JSON.stringify({ reportId, decision, actionTaken }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      toast.success(`Report #${reportId} → ${data.status}`)
      setReports(prev => prev.filter(r => r.id !== reportId))
    } catch (err) {
      toast.error(err.message)
    } finally {
      setActing(null)
    }
  }

  if (authLoading) return <div className="admin-reports-loading">Loading…</div>

  if (!isAdmin) {
    return (
      <div className="admin-reports-404">
        <h1>404</h1>
        <p>Page not found.</p>
        <Link to="/">Back to ROAM</Link>
      </div>
    )
  }

  return (
    <div className="admin-reports">
      <header className="admin-reports-header">
        <h1>Reports queue</h1>
        <p className="admin-reports-subtitle">
          {total} {status} {severity ? `· ${severity}` : ''} report{total === 1 ? '' : 's'}
        </p>
      </header>

      <div className="admin-reports-filters">
        <div className="admin-reports-filter-group">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              className={`admin-reports-chip ${status === f.value ? 'active' : ''}`}
              onClick={() => setStatus(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="admin-reports-filter-group">
          {SEVERITY_FILTERS.map(f => (
            <button
              key={f.value ?? 'all'}
              className={`admin-reports-chip ${severity === f.value ? 'active' : ''}`}
              onClick={() => setSeverity(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="admin-reports-loading">Loading reports…</div>
      ) : reports.length === 0 ? (
        <div className="admin-reports-empty">
          <p>Inbox zero. {status === 'open' ? "Nothing needs your attention." : 'No reports match this filter.'}</p>
        </div>
      ) : (
        <ul className="admin-reports-list">
          {reports.map(r => (
            <ReportRow key={r.id} report={r} acting={acting === r.id} onDecide={decide} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ReportRow({ report, acting, onDecide }) {
  const isContent = report.entity_type === 'contribution' || report.entity_type === 'photo'
  const severity = report.ai_severity || 'untriaged'
  const created = report.created_at ? new Date(report.created_at).toLocaleString() : ''

  return (
    <li className={`admin-report admin-report-sev-${severity}`}>
      <div className="admin-report-row1">
        <span className={`admin-report-sev-badge sev-${severity}`}>{severity.toUpperCase()}</span>
        <span className="admin-report-entity">
          {report.entity_type} <strong>#{report.entity_id}</strong>
        </span>
        <span className="admin-report-reason">{report.reason}</span>
        <span className="admin-report-time">{created}</span>
      </div>

      <div className="admin-report-row2">
        <div className="admin-report-meta">
          <strong>Reporter:</strong> @{report.reporter_username || 'anonymous'}
          {report.reported_username && <> · <strong>Author:</strong> @{report.reported_username}</>}
        </div>
        {report.details && (
          <blockquote className="admin-report-details">"{report.details}"</blockquote>
        )}
      </div>

      {report.ai_reason && (
        <div className="admin-report-ai">
          <span className="admin-report-ai-label">AI:</span> {report.ai_reason}
          {report.ai_action_taken && report.ai_action_taken !== 'none' && (
            <span className="admin-report-ai-action"> · auto: {report.ai_action_taken}</span>
          )}
        </div>
      )}

      {report.content_text && (
        <div className="admin-report-content">
          <span className="admin-report-content-label">Content:</span>
          <p>{report.content_text}</p>
          {report.content_status === 'rejected' && (
            <span className="admin-report-content-flag">⨯ already hidden</span>
          )}
        </div>
      )}

      <div className="admin-report-actions">
        <button
          className="admin-report-btn admin-report-btn-secondary"
          disabled={acting}
          onClick={() => onDecide(report.id, 'dismiss', 'none')}
        >
          Dismiss
        </button>
        <button
          className="admin-report-btn admin-report-btn-secondary"
          disabled={acting}
          onClick={() => onDecide(report.id, 'review', 'none')}
        >
          Mark reviewed
        </button>
        {isContent && report.content_status !== 'rejected' && (
          <button
            className="admin-report-btn admin-report-btn-destructive"
            disabled={acting}
            onClick={() => onDecide(report.id, 'action', 'hide_content')}
          >
            Hide content
          </button>
        )}
        {report.reported_user_id && (
          <button
            className="admin-report-btn admin-report-btn-destructive"
            disabled={acting}
            onClick={() => {
              if (!window.confirm(`Ban @${report.reported_username || `user ${report.reported_user_id}`}? They will not be able to sign in.`)) return
              onDecide(report.id, 'action', 'ban_user')
            }}
          >
            Ban @{report.reported_username || 'user'}
          </button>
        )}
      </div>
    </li>
  )
}

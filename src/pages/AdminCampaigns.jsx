/**
 * AdminCampaigns
 *
 * Operator console for creating + managing sponsored place campaigns.
 * Non-admins see a 404 (route-level via AdminRoute). The API enforces
 * is_admin too; this UI is advisory.
 *
 * Workflow:
 *   1. Fill the form with the place + business + budget details
 *   2. Hit Create — campaign starts as 'draft' unless "Activate now" is
 *      ticked
 *   3. Drafts/paused campaigns show up in the list below; flip them
 *      to active when you've got payment from the business
 *   4. Cancel cleans up but keeps the row for audit
 *
 * Stats columns (impressions / clicks / saves) are read straight from
 * the ad_impressions table so they update in near-real-time as the
 * discovery feed serves the card.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useToast } from '../hooks/useToast'
import AdminLayout from '../components/AdminLayout'
import AdminStatus from '../components/AdminStatus'
import ConfirmModal from '../components/ConfirmModal'
import { formatDate } from '../components/adminFormat'
import './AdminCampaigns.css'
import { authHeaders } from '../utils/authToken'

const STATUS_LABELS = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

// Match the category keys used in the rest of the app — the
// target_categories array is matched against these via JSON_CONTAINS in
// the /api/ads/sponsored query.
const TARGET_CATEGORY_OPTIONS = [
  { key: 'food_drink', label: 'Food and drink' },
  { key: 'nature', label: 'Nature and outdoors' },
  { key: 'culture', label: 'Culture and history' },
  { key: 'shopping', label: 'Shopping' },
  { key: 'entertainment', label: 'Entertainment' },
  { key: 'sports', label: 'Sports and activity' },
  { key: 'family', label: 'Family-friendly' },
]

const STATUS_TONE = { active: 'ok', paused: 'warn', draft: '', completed: '', cancelled: 'danger' }
const STATUS_FILTERS = [
  { value: 'live', label: 'Not cancelled' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'draft', label: 'Draft' },
  { value: 'all', label: 'All' },
]

const EMPTY_FORM = {
  place_id: '',
  place_name: '',
  place_lat: '',
  place_lng: '',
  place_category: '',
  place_image: '',
  campaign_name: '',
  business_name: '',
  business_email: '',
  business_phone: '',
  budget_total_pounds: '',
  cpm_pounds: '10.00',
  target_categories: [],
  target_radius_km: 50,
  start_date: new Date().toISOString().slice(0, 10),
  end_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  activate_immediately: false,
}

export default function AdminCampaigns() {
  const toast = useToast()
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [statusFilter, setStatusFilter] = useState('live')
  const [query, setQuery] = useState('')

  const fetchCampaigns = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/campaigns', {
        credentials: 'include',
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error(`The server answered ${res.status}`)
      const data = await res.json()
      setCampaigns(data.campaigns || [])
    } catch (err) {
      setError(err.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchCampaigns() }, [fetchCampaigns])

  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }))

  const toggleTargetCategory = (key) => {
    setForm(prev => ({
      ...prev,
      target_categories: prev.target_categories.includes(key)
        ? prev.target_categories.filter(k => k !== key)
        : [...prev.target_categories, key],
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const payload = {
        place_id: form.place_id.trim(),
        place_name: form.place_name.trim(),
        place_lat: parseFloat(form.place_lat),
        place_lng: parseFloat(form.place_lng),
        place_category: form.place_category || null,
        place_image: form.place_image.trim() || null,
        campaign_name: form.campaign_name.trim() || null,
        business_name: form.business_name.trim(),
        business_email: form.business_email.trim(),
        business_phone: form.business_phone.trim() || null,
        budget_total_pence: Math.round((parseFloat(form.budget_total_pounds) || 0) * 100),
        cpm_pence: Math.round((parseFloat(form.cpm_pounds) || 10) * 100),
        target_categories: form.target_categories.length ? form.target_categories : null,
        target_radius_km: parseInt(form.target_radius_km, 10) || 50,
        start_date: form.start_date,
        end_date: form.end_date,
        activate_immediately: form.activate_immediately,
      }
      const res = await fetch('/api/admin/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.code === 'STALE_SESSION') throw new Error('Sign in again before creating campaigns.')
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      toast.success(`Campaign #${data.id} created (${data.status})`)
      setForm(EMPTY_FORM)
      setShowForm(false)
      fetchCampaigns()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const updateStatus = async (id, status) => {
    try {
      const res = await fetch('/api/admin/campaigns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        credentials: 'include',
        body: JSON.stringify({ id, status }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.code === 'STALE_SESSION') throw new Error('Sign in again to change status.')
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      toast.success(`Campaign #${id} is now ${STATUS_LABELS[status]?.toLowerCase() || status}`)
      fetchCampaigns()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const cancel = async () => {
    if (!cancelTarget) return
    const id = cancelTarget.id
    setCancelTarget(null)
    try {
      const res = await fetch('/api/admin/campaigns', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        credentials: 'include',
        body: JSON.stringify({ id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.code === 'STALE_SESSION') throw new Error('Sign in again to cancel.')
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      toast.success(`Campaign #${id} cancelled`)
      fetchCampaigns()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return campaigns.filter((c) => {
      if (statusFilter === 'live' && c.status === 'cancelled') return false
      if (!['live', 'all'].includes(statusFilter) && c.status !== statusFilter) return false
      if (!q) return true
      const name = placeName(c)
      return [name, c.business_name, c.campaign_name, c.place_id].some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [campaigns, statusFilter, query])

  const newButton = (
    <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowForm((v) => !v)} aria-expanded={showForm}>
      {showForm ? 'Close form' : 'New campaign'}
    </button>
  )

  return (
    <AdminLayout
      title="Sponsored campaigns"
      subtitle="Promote a local business in the Discover feed. Free users see one every 8 cards; ROAM+ members never do."
      actions={newButton}
    >
      <div className="admin-campaigns">

      {showForm && (
      <section className="admin-campaigns-section">
        <h2>New campaign</h2>
        <form className="admin-campaigns-form" onSubmit={submit}>
          <fieldset>
            <legend>Place</legend>
            <label>
              <span>Place ID</span>
              <input
                type="text"
                required
                value={form.place_id}
                onChange={e => setField('place_id', e.target.value)}
                placeholder="osm:node/123456 or roam:abc123"
              />
            </label>
            <label>
              <span>Place name</span>
              <input
                type="text"
                required
                value={form.place_name}
                onChange={e => setField('place_name', e.target.value)}
                placeholder="The Crown Inn"
              />
            </label>
            <div className="form-row">
              <label>
                <span>Latitude</span>
                <input
                  type="number"
                  step="any"
                  required
                  value={form.place_lat}
                  onChange={e => setField('place_lat', e.target.value)}
                  placeholder="51.5074"
                />
              </label>
              <label>
                <span>Longitude</span>
                <input
                  type="number"
                  step="any"
                  required
                  value={form.place_lng}
                  onChange={e => setField('place_lng', e.target.value)}
                  placeholder="-0.1278"
                />
              </label>
            </div>
            <label>
              <span>Category (optional)</span>
              <input
                type="text"
                value={form.place_category}
                onChange={e => setField('place_category', e.target.value)}
                placeholder="food_drink, nature, culture…"
              />
            </label>
            <label>
              <span>Image URL (optional)</span>
              <input
                type="url"
                value={form.place_image}
                onChange={e => setField('place_image', e.target.value)}
                placeholder="https://…"
              />
            </label>
          </fieldset>

          <fieldset>
            <legend>Business</legend>
            <label>
              <span>Business name</span>
              <input
                type="text"
                required
                value={form.business_name}
                onChange={e => setField('business_name', e.target.value)}
                placeholder="The Crown Inn Ltd"
              />
            </label>
            <label>
              <span>Business email</span>
              <input
                type="email"
                required
                value={form.business_email}
                onChange={e => setField('business_email', e.target.value)}
                placeholder="manager@crowninn.co.uk"
              />
            </label>
            <label>
              <span>Business phone (optional)</span>
              <input
                type="tel"
                value={form.business_phone}
                onChange={e => setField('business_phone', e.target.value)}
                placeholder="+44 …"
              />
            </label>
          </fieldset>

          <fieldset>
            <legend>Campaign</legend>
            <label>
              <span>Campaign name (optional)</span>
              <input
                type="text"
                value={form.campaign_name}
                onChange={e => setField('campaign_name', e.target.value)}
                placeholder="Summer 2026"
              />
            </label>
            <div className="form-row">
              <label>
                <span>Total budget (£)</span>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={form.budget_total_pounds}
                  onChange={e => setField('budget_total_pounds', e.target.value)}
                  placeholder="100.00 (0 = unlimited)"
                />
              </label>
              <label>
                <span>CPM (£ per 1k impressions)</span>
                <input
                  type="number"
                  step="0.01"
                  value={form.cpm_pounds}
                  onChange={e => setField('cpm_pounds', e.target.value)}
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                <span>Start date</span>
                <input
                  type="date"
                  required
                  value={form.start_date}
                  onChange={e => setField('start_date', e.target.value)}
                />
              </label>
              <label>
                <span>End date</span>
                <input
                  type="date"
                  required
                  value={form.end_date}
                  onChange={e => setField('end_date', e.target.value)}
                />
              </label>
            </div>
            <label>
              <span>Target radius (km)</span>
              <input
                type="number"
                min="1"
                max="500"
                value={form.target_radius_km}
                onChange={e => setField('target_radius_km', e.target.value)}
              />
            </label>
            <fieldset className="target-categories">
              <legend>Target categories (optional — leave all unchecked to target everyone)</legend>
              <div className="checkbox-grid">
                {TARGET_CATEGORY_OPTIONS.map(opt => (
                  <label key={opt.key} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.target_categories.includes(opt.key)}
                      onChange={() => toggleTargetCategory(opt.key)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="checkbox-label inline">
              <input
                type="checkbox"
                checked={form.activate_immediately}
                onChange={e => setField('activate_immediately', e.target.checked)}
              />
              Activate immediately (instead of saving as draft)
            </label>
          </fieldset>

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create campaign'}
          </button>
        </form>
      </section>
      )}

      <div className="admin-toolbar">
        <div className="admin-chips" role="group" aria-label="Filter campaigns by status">
          {STATUS_FILTERS.map((f) => (
            <button key={f.value} type="button" className={`chip${statusFilter === f.value ? ' selected' : ''}`} aria-pressed={statusFilter === f.value} onClick={() => setStatusFilter(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="admin-search" role="search">
          <input type="search" placeholder="Search place or business" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search campaigns" />
        </div>
      </div>

      <AdminStatus
        loading={loading}
        error={error}
        onRetry={fetchCampaigns}
        empty={visible.length === 0}
        emptyTitle={campaigns.length === 0 ? 'No campaigns yet' : 'No campaigns match'}
        emptyText={campaigns.length === 0 ? 'Create one with New campaign when a business signs up.' : 'Try another filter or search.'}
      >
        <div className="admin-table-wrap">
          <table className="admin-table campaigns-table">
            <thead>
              <tr>
                <th scope="col">Campaign</th>
                <th scope="col">Status</th>
                <th scope="col">Runs</th>
                <th scope="col" className="num">Spend</th>
                <th scope="col" className="num">Impressions</th>
                <th scope="col" className="num">Clicks</th>
                <th scope="col" className="num">Saves</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(c => (
                <CampaignRow
                  key={c.id}
                  campaign={c}
                  onActivate={() => updateStatus(c.id, 'active')}
                  onPause={() => updateStatus(c.id, 'paused')}
                  onResume={() => updateStatus(c.id, 'active')}
                  onCancel={() => setCancelTarget(c)}
                />
              ))}
            </tbody>
          </table>
        </div>
        <div className="admin-pager"><span>Showing {visible.length} of {campaigns.length} (newest 200)</span></div>
      </AdminStatus>

      <ConfirmModal
        isOpen={!!cancelTarget}
        title="Cancel this campaign?"
        message={`${cancelTarget ? placeName(cancelTarget) : ''} stops getting impressions straight away. The campaign stays on record for the audit log.`}
        confirmLabel="Cancel campaign"
        cancelLabel="Keep it"
        destructive
        onConfirm={cancel}
        onCancel={() => setCancelTarget(null)}
      />
      </div>
    </AdminLayout>
  )
}

function placeName(campaign) {
  const placeData = typeof campaign.place_data === 'string' ? safeJson(campaign.place_data) : campaign.place_data
  return placeData?.name || campaign.place_id
}

function CampaignRow({ campaign, onActivate, onPause, onResume, onCancel }) {
  const targetCategories = typeof campaign.target_categories === 'string'
    ? safeJson(campaign.target_categories)
    : campaign.target_categories
  const budgetTotal = (campaign.budget_total_pence / 100).toFixed(2)
  const budgetSpent = (campaign.budget_spent_pence / 100).toFixed(2)
  const isUnlimited = campaign.budget_total_pence === 0
  const isCancelled = campaign.status === 'cancelled'
  const tone = STATUS_TONE[campaign.status]

  return (
    <tr className={isCancelled ? 'is-cancelled' : ''}>
      <td className="campaign-cell">
        <strong>{placeName(campaign)}</strong>
        <span className="admin-muted">{campaign.business_name}{campaign.campaign_name ? ` · ${campaign.campaign_name}` : ''}</span>
        <span className="admin-muted">
          CPM £{(campaign.cpm_pence / 100).toFixed(2)} · {campaign.target_radius_km} km
          {targetCategories?.length > 0 ? ` · ${targetCategories.join(', ')}` : ''}
        </span>
      </td>
      <td><span className={`admin-badge${tone ? ` admin-badge-${tone}` : ''}`}>{STATUS_LABELS[campaign.status] || campaign.status}</span></td>
      <td className="campaign-dates">{formatDate(campaign.start_date)}<span className="admin-muted">to {formatDate(campaign.end_date)}</span></td>
      <td className="num">£{budgetSpent}<span className="admin-muted campaign-of">of {isUnlimited ? 'no cap' : `£${budgetTotal}`}</span></td>
      <td className="num">{Number(campaign.impression_count || 0).toLocaleString('en-GB')}</td>
      <td className="num">{Number(campaign.click_count || 0).toLocaleString('en-GB')}</td>
      <td className="num">{Number(campaign.save_count || 0).toLocaleString('en-GB')}</td>
      <td>
        <div className="campaign-actions">
        {!isCancelled && (
          <>
            {campaign.status === 'draft' && <button type="button" onClick={onActivate} className="btn btn-primary btn-sm">Activate</button>}
            {campaign.status === 'active' && <button type="button" onClick={onPause} className="btn btn-secondary btn-sm">Pause</button>}
            {campaign.status === 'paused' && <button type="button" onClick={onResume} className="btn btn-primary btn-sm">Resume</button>}
            <button type="button" onClick={onCancel} className="btn btn-danger btn-sm">Cancel</button>
          </>
        )}
      </div>
      </td>
    </tr>
  )
}

function safeJson(str) {
  try { return JSON.parse(str) } catch { return null }
}

/**
 * Client for the /api/partners/* endpoints (web-only partner portal).
 * Mirrors the auth-header convention used by the admin pages.
 */

function authHeaders() {
  const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function req(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders()
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  let data = null
  try { data = await res.json() } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`)
    err.status = res.status
    err.code = data?.code
    throw err
  }
  return data
}

// Partner account
export const getPartnerAccount = () => req('/api/partners/account')
export const savePartnerAccount = (account) => req('/api/partners/account', { method: 'POST', body: account })

// Events
export const listPartnerEvents = () => req('/api/partners/events')
export const getPartnerEvent = (id) => req(`/api/partners/events?id=${encodeURIComponent(id)}`)
export const createPartnerEvent = (event) => req('/api/partners/events', { method: 'POST', body: event })
export const updatePartnerEvent = (event) => req('/api/partners/events', { method: 'PATCH', body: event })
export const cancelPartnerEvent = (id) => req(`/api/partners/events?id=${encodeURIComponent(id)}`, { method: 'DELETE' })

// Pricing + checkout
export const getPromoQuote = (params) => req('/api/partners/quote', { method: 'POST', body: params })
export const startPromoCheckout = (promotedEventId) =>
  req('/api/partners/checkout', { method: 'POST', body: { promoted_event_id: promotedEventId } })

/** Format pence as £x.xx */
export function formatPence(pence) {
  const n = Number(pence) || 0
  return `£${(n / 100).toFixed(2)}`
}

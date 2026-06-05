/**
 * Promoted ("Featured") events client.
 *
 * Fetches first-party, paid promoted events from /api/events/promoted and maps
 * them into the shared RoamEvent shape so they merge seamlessly into the
 * What's On feed. Also exposes lightweight impression/click/save tracking.
 *
 * Fails soft everywhere: a promoted-events failure must never break the feed.
 */

const SESSION_KEY = 'roam_session_id'

/** Stable per-session id, shared with the sponsored-card tracker. */
function getSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      sessionStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    // sessionStorage can throw in private mode — fall back to an ephemeral id.
    return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  }
}

/**
 * Fetch promoted events near a location, mapped to the RoamEvent shape.
 * @returns {Promise<Array>} RoamEvent[] (empty on any failure)
 */
export async function fetchPromotedEvents(lat, lng, radiusKm = 30) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return []
  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      radiusKm: String(radiusKm)
    })
    const res = await fetch(`/api/events/promoted?${params.toString()}`)
    if (!res.ok) return []
    const data = await res.json()
    const promoted = Array.isArray(data?.promoted) ? data.promoted : []
    return promoted.map(mapToRoamEvent).filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Track an interaction with a promoted event. Fire-and-forget.
 * @param {number} promotedId raw promoted_events.id
 * @param {'impression'|'click'|'save'} action
 * @param {{lat?: number, lng?: number}} [coords]
 */
export function trackPromotedEvent(promotedId, action, coords = {}) {
  if (!promotedId || !action) return
  try {
    const body = {
      promoted_event_id: promotedId,
      session_id: getSessionId(),
      action
    }
    if (typeof coords.lat === 'number' && typeof coords.lng === 'number') {
      body.user_lat = coords.lat
      body.user_lng = coords.lng
    }
    // keepalive so the click beacon survives a navigation away.
    fetch('/api/events/promoted-impression', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true
    }).catch(() => {})
  } catch {
    // never throw from tracking
  }
}

/** Map an /api/events/promoted row into the shared RoamEvent shape. */
function mapToRoamEvent(p) {
  if (!p || !p.id) return null
  const start = p.startsAt ? new Date(p.startsAt) : null
  if (!start || isNaN(start)) return null
  const end = p.endsAt ? new Date(p.endsAt) : null

  return {
    id: `promoted_${p.id}`,
    promotedId: p.id,
    source: 'roam_promoted',
    isFeatured: true,
    orgName: p.orgName || null,
    name: p.title,
    description: p.description || '',
    datetime: { start, end: end && !isNaN(end) ? end : null },
    venue: {
      name: p.venue?.name || p.orgName || '',
      address: p.venue?.address || '',
      lat: typeof p.venue?.lat === 'number' ? p.venue.lat : null,
      lng: typeof p.venue?.lng === 'number' ? p.venue.lng : null
    },
    categories: p.category ? [p.category] : [],
    pricing: parsePriceInfo(p.priceInfo),
    isSoldOut: false,
    imageUrl: p.imageUrl || null,
    ticketUrl: p.infoUrl || null,
    // Admission model: 'online' (buy online), 'door' (pay on the door), 'free'.
    // Drives the card's call-to-action so a no-link / door / free event reads
    // correctly instead of falsely saying "Get Tickets".
    ticketType: p.ticketType || 'online',
    distanceKm: typeof p.distanceKm === 'number' ? p.distanceKm : null
  }
}

/** Turn an organiser's free-text price ("Free", "£10") into the pricing shape. */
function parsePriceInfo(priceInfo) {
  if (!priceInfo || typeof priceInfo !== 'string') {
    return { isFree: false, minPrice: null, maxPrice: null, currency: 'GBP' }
  }
  if (/free/i.test(priceInfo)) {
    return { isFree: true, minPrice: 0, maxPrice: 0, currency: 'GBP' }
  }
  const match = priceInfo.replace(/,/g, '').match(/\d+(\.\d+)?/)
  const minPrice = match ? Number(match[0]) : null
  return { isFree: false, minPrice, maxPrice: null, currency: 'GBP' }
}

export default { fetchPromotedEvents, trackPromotedEvent }

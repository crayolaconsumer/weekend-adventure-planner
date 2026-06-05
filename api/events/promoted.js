/**
 * GET /api/events/promoted
 *
 * Returns active, paid, live promoted events near the user, to be merged
 * into the in-app "What's On" feed as "Featured" cards.
 *
 * Sibling of /api/ads/sponsored (places). Differences:
 *   - event-based (time-bound) not place-based
 *   - flat-fee, so impressions are analytics-only (no budget depletion)
 *   - an event is shown only when the user is within BOTH the organiser's
 *     purchased promo_radius_km AND the user's selected filter radius.
 *
 * Fails soft: on the kill-switch being off, or any error, returns an empty
 * list so the events feed never breaks.
 */

import { query } from '../lib/db.js'
import { parseCoordinates, validatePagination } from '../lib/validation.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'
import { isFeatureEnabled } from '../lib/flags.js'

const MAX_RADIUS_KM = 100
const DEFAULT_RADIUS_KM = 30

async function handler(req, res) {
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'events:promoted')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Kill-switch: disable the whole feature without a deploy.
    if (!(await isFeatureEnabled('promotedEvents'))) {
      return res.status(200).json({ promoted: [], count: 0 })
    }

    const coords = parseCoordinates(req.query.lat, req.query.lng)
    if (!coords.valid) {
      // Local targeting requires a user location; without it, nothing to show.
      return res.status(200).json({ promoted: [], count: 0 })
    }

    const radiusKm = clampRadius(req.query.radiusKm)
    const { limit } = validatePagination(req.query.limit, 0, 10)
    const category = typeof req.query.category === 'string' ? req.query.category : null

    // Bounding-box prefilter keeps the query light on the shared Aurora box.
    const box = boundingBox(coords.lat, coords.lng, radiusKm)

    let sql = `
      SELECT
        pe.id, pe.title, pe.description, pe.category,
        pe.venue_name, pe.address, pe.lat, pe.lng,
        pe.starts_at, pe.ends_at, pe.image_url, pe.info_url, pe.price_info,
        pe.promo_radius_km,
        pa.org_name
      FROM promoted_events pe
      JOIN partner_accounts pa ON pe.partner_id = pa.id
      WHERE pe.status = 'active'
        AND pe.payment_status = 'paid'
        AND pe.moderation_status = 'live'
        AND pa.status = 'active'
        AND pe.promo_starts_on <= CURDATE()
        AND pe.promo_ends_on >= CURDATE()
        AND pe.starts_at >= (NOW() - INTERVAL 6 HOUR)
        AND pe.lat BETWEEN ? AND ?
        AND pe.lng BETWEEN ? AND ?
    `
    const params = [box.minLat, box.maxLat, box.minLng, box.maxLng]

    if (category) {
      sql += ` AND (pe.category IS NULL OR pe.category = ?)`
      params.push(category)
    }

    // Pull a few extra candidates; precise distance filter happens in JS.
    sql += ` ORDER BY pe.starts_at ASC LIMIT 50`

    const rows = await query(sql, params)

    const results = rows
      .map(row => {
        const distance = haversineKm(coords.lat, coords.lng, Number(row.lat), Number(row.lng))
        return { row, distance }
      })
      // Within BOTH the organiser's purchased radius AND the user's filter.
      .filter(({ row, distance }) =>
        distance != null && distance <= Math.min(Number(row.promo_radius_km) || MAX_RADIUS_KM, radiusKm)
      )
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit)
      .map(({ row, distance }) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        category: row.category,
        venue: { name: row.venue_name, address: row.address, lat: Number(row.lat), lng: Number(row.lng) },
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        imageUrl: row.image_url,
        infoUrl: row.info_url,
        priceInfo: row.price_info,
        orgName: row.org_name,
        distanceKm: distance
      }))

    return res.status(200).json({ promoted: results, count: results.length })
  } catch (error) {
    console.error('Promoted events error:', error)
    // Fail soft — never break the events feed.
    return res.status(200).json({ promoted: [], count: 0 })
  }
}

function clampRadius(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RADIUS_KM
  return Math.min(Math.max(n, 1), MAX_RADIUS_KM)
}

/** Approximate lat/lng bounding box for a radius in km. */
function boundingBox(lat, lng, radiusKm) {
  const latDelta = radiusKm / 111.0
  const cos = Math.cos((lat * Math.PI) / 180)
  const lngDelta = radiusKm / (111.0 * (Math.abs(cos) < 1e-6 ? 1e-6 : cos))
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta
  }
}

/** Distance between two coordinates in km (Haversine). */
function haversineKm(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(n => typeof n === 'number' && Number.isFinite(n))) {
    return null
  }
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(R * c * 10) / 10
}

function toRad(deg) {
  return deg * (Math.PI / 180)
}

export default withCors(handler)

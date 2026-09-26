/**
 * GET /api/og/place?id=w123
 * Link-preview image for a shared place without a photo (see api/share-meta.js).
 * Text comes from the place itself, never from the URL, so nobody can print
 * their own words on a ROAM-branded image. Look: api/lib/ogCard.js.
 */
import { sendCard } from '../lib/ogCard.js'
import { lookupPlace, isOsmId } from '../lib/placeLookup.js'
import { applyRateLimit, RATE_LIMITS, getRateLimitKey } from '../lib/rateLimit.js'

export const config = { runtime: 'nodejs' }

const GENERIC = { title: 'Find places worth the trip', subtitle: 'Parks, sights and places to eat near you' }

export default async function handler(req, res) {
  const limited = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'og')
  if (limited) return res.status(429).end()
  const id = req.query?.id
  try {
    const place = isOsmId(id) ? await lookupPlace(id, getRateLimitKey(req)).catch(() => null) : null
    if (!place) return await sendCard(res, GENERIC, { sMaxAge: 3600 })
    const subtitle = [place.kind, place.where && `in ${place.where}`].filter(Boolean).join(' ')
    return await sendCard(res, { title: place.name, subtitle, icon: place.icon })
  } catch (err) {
    console.error('[og/place]', err.message)
    return res.status(500).end()
  }
}

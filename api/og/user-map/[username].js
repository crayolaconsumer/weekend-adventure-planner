/* global Buffer */
/**
 * GET /api/og/user-map/[username]
 *
 * Server-rendered 1200×630 OG image for the user's visited map.
 * Used by /api/share/user-map/[username] (the share-prerender redirect)
 * to provide rich link previews in iMessage/WhatsApp/Slack/Twitter.
 *
 * Privacy:
 *   - is_private_account=true → generic ROAM brand card (don't confirm existence)
 *   - is_map_public=true → full constellation card with real coords
 *   - Otherwise (followers-only default) → teaser card with abstracted coords
 *
 * Runs on Node.js runtime (not edge) because mysql2/promise isn't
 * edge-compatible. Cache-Control s-maxage=300 keeps Vercel warm for
 * repeat shares.
 */

import { ImageResponse } from '@vercel/og'
import { queryOne, query } from '../../lib/db.js'
import { formatDisplayName } from '../../lib/displayName.js'
import { applyRateLimit, RATE_LIMITS } from '../../lib/rateLimit.js'

const TEASER_CELL_DEGREES = 0.5

const genericCard = (
  <div style={{
    width: '100%',
    height: '100%',
    background: 'linear-gradient(135deg, #f5f0e6 0%, #e8dec9 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'serif',
    fontSize: 64,
    color: '#1a3a2f',
    fontWeight: 600,
    letterSpacing: '0.1em'
  }}>
    ROAM
  </div>
)

export default async function handler(req, res) {
  // Edge cache absorbs most legitimate traffic; rate limit catches
  // cache-busting / scraping attempts before they hit the DB or
  // ImageResponse render.
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'og:user-map')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const { username } = req.query
  if (!username || typeof username !== 'string') {
    const img = new ImageResponse(genericCard, { width: 1200, height: 630 })
    return forwardImageResponse(img, res, 3600)
  }

  try {
    const target = await queryOne(
      `SELECT u.id, u.username, u.display_name, u.avatar_url,
              ups.is_private_account, ups.is_map_public
       FROM users u
       LEFT JOIN user_privacy_settings ups ON ups.user_id = u.id
       WHERE u.username = ?`,
      [username]
    )

    // Default-private if no privacy row exists
    const isPrivateAccount = target ? (target.is_private_account === null ? true : !!target.is_private_account) : true

    if (!target || isPrivateAccount) {
      const img = new ImageResponse(genericCard, { width: 1200, height: 630 })
      return forwardImageResponse(img, res, 3600)
    }

    const isFull = !!target.is_map_public

    const rows = await query(
      `SELECT place_data FROM visited_places WHERE user_id = ? ORDER BY visited_at DESC LIMIT 200`,
      [target.id]
    )

    const points = rows
      .map(r => {
        const data = typeof r.place_data === 'string' ? JSON.parse(r.place_data) : r.place_data
        const lat = data?.lat
        const lng = data?.lng ?? data?.lon
        if (typeof lat !== 'number' || typeof lng !== 'number') return null
        if (isFull) return { lat, lng }
        const cellLat = Math.floor(lat / TEASER_CELL_DEGREES) * TEASER_CELL_DEGREES
        const cellLng = Math.floor(lng / TEASER_CELL_DEGREES) * TEASER_CELL_DEGREES
        return {
          lat: cellLat + Math.random() * TEASER_CELL_DEGREES,
          lng: cellLng + Math.random() * TEASER_CELL_DEGREES
        }
      })
      .filter(Boolean)

    const total = rows.length

    let minLat = 0, maxLat = 0, minLng = 0, maxLng = 0
    if (points.length > 0) {
      const lats = points.map(p => p.lat)
      const lngs = points.map(p => p.lng)
      minLat = Math.min(...lats)
      maxLat = Math.max(...lats)
      minLng = Math.min(...lngs)
      maxLng = Math.max(...lngs)
    }
    const latRange = (maxLat - minLat) || 1
    const lngRange = (maxLng - minLng) || 1

    const card = (
      <div style={{
        width: '100%',
        height: '100%',
        background: 'linear-gradient(135deg, #f5f0e6 0%, #e8dec9 100%)',
        padding: 48,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'serif'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          {target.avatar_url && (
            <img
              src={target.avatar_url}
              width={96}
              height={96}
              style={{ borderRadius: 48, objectFit: 'cover' }}
              alt=""
            />
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 48, color: '#1a3a2f', fontWeight: 600 }}>
              {formatDisplayName(target)}'s map
            </div>
            <div style={{ fontSize: 26, color: '#5a7a6e' }}>
              {total} {total === 1 ? 'place' : 'places'} visited{!isFull && ' · followers see the real map'}
            </div>
          </div>
        </div>

        <div style={{
          position: 'relative',
          flex: 1,
          margin: '32px 0',
          background: 'rgba(26, 58, 47, 0.04)',
          borderRadius: 24,
          display: 'flex'
        }}>
          {points.map((p, i) => {
            const x = ((p.lng - minLng) / lngRange) * 100
            const y = ((maxLat - p.lat) / latRange) * 100
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${x}%`,
                  top: `${y}%`,
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  background: '#1a3a2f',
                  transform: 'translate(-50%, -50%)',
                  boxShadow: '0 0 16px rgba(26, 58, 47, 0.4)',
                  display: 'flex'
                }}
              />
            )
          })}
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: '#1a3a2f',
          fontSize: 24
        }}>
          <span style={{ fontWeight: 600, letterSpacing: '0.1em' }}>ROAM</span>
          <span style={{ opacity: 0.6 }}>go-roam.uk</span>
        </div>
      </div>
    )

    const img = new ImageResponse(card, { width: 1200, height: 630 })
    return forwardImageResponse(img, res, 3600)
  } catch (err) {
    console.error('OG render error', err)
    const img = new ImageResponse(genericCard, { width: 1200, height: 630 })
    return forwardImageResponse(img, res, 60)
  }
}

// Helper: pipe an ImageResponse (Web Response) into Node's res object.
async function forwardImageResponse(imageResponse, res, sMaxAge) {
  const buffer = Buffer.from(await imageResponse.arrayBuffer())
  res.setHeader('Content-Type', 'image/png')
  // Long edge cache + stale-while-revalidate. The image only changes
  // when the user adds/removes places; one render per hour at the
  // edge is plenty.
  res.setHeader('Cache-Control', `public, s-maxage=${sMaxAge}, stale-while-revalidate=86400`)
  return res.status(200).send(buffer)
}

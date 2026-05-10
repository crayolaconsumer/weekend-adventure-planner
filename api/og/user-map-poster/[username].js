/* global Buffer */
/**
 * GET /api/og/user-map-poster/[username]
 *
 * 1200×1700 portrait poster of a user's visited places. Premium-gated:
 * non-premium owners get 402 (used by the client to surface
 * UpgradePrompt with type="export"). Non-owners cannot generate a
 * poster of someone else's map (privacy + IP protection).
 *
 * Renders via @vercel/og on the Node runtime (mysql2 isn't edge-safe).
 * Streams the PNG with a strong cache hint for the rare case the
 * same poster is regenerated quickly (hard-refresh).
 */

import { ImageResponse } from '@vercel/og'
import { queryOne, query } from '../../lib/db.js'
import { formatDisplayName } from '../../lib/displayName.js'
import { isPremiumRow } from '../../lib/premium.js'
import { getUserFromRequest } from '../../lib/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { username } = req.query
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username required' })
  }

  try {
    const target = await queryOne(
      `SELECT id, username, display_name, avatar_url, tier, subscription_expires_at
       FROM users
       WHERE username = ?`,
      [username]
    )
    if (!target) {
      return res.status(404).json({ error: 'Not found' })
    }

    // Owner-only check — posters are personal artifacts. Avoids someone
    // generating a poster of a stranger's map.
    const viewer = await getUserFromRequest(req)
    if (!viewer || viewer.id !== target.id) {
      return res.status(403).json({ error: 'You can only export your own map' })
    }

    if (!isPremiumRow(target)) {
      return res.status(402).json({
        error: 'premium_required',
        message: 'Map posters are a ROAM+ feature.',
        upgradeUrl: '/pricing'
      })
    }

    const rows = await query(
      `SELECT place_id, place_data, visited_at, rating
       FROM visited_places
       WHERE user_id = ?
       ORDER BY visited_at DESC
       LIMIT 200`,
      [target.id]
    )

    const places = rows
      .map(r => {
        const data = typeof r.place_data === 'string' ? JSON.parse(r.place_data) : r.place_data
        const lat = data?.lat
        const lng = data?.lng ?? data?.lon
        if (typeof lat !== 'number' || typeof lng !== 'number') return null
        return { lat, lng, name: data?.name || 'Unnamed place', rating: r.rating }
      })
      .filter(Boolean)

    const total = places.length
    const recommended = places.filter(p => p.rating != null && p.rating > 3).length
    const friendlyName = formatDisplayName(target)

    let minLat = 0, maxLat = 0, minLng = 0, maxLng = 0
    if (places.length > 0) {
      const lats = places.map(p => p.lat)
      const lngs = places.map(p => p.lng)
      minLat = Math.min(...lats); maxLat = Math.max(...lats)
      minLng = Math.min(...lngs); maxLng = Math.max(...lngs)
    }
    const latRange = (maxLat - minLat) || 1
    const lngRange = (maxLng - minLng) || 1

    const dotColor = (rating) => {
      if (rating == null) return '#94a3b8'
      if (rating > 3) return '#16a34a'
      return '#dc2626'
    }

    // Top N place names rendered in the lower text block. Cap to keep layout balanced.
    const topPlaces = places.slice(0, 18)

    const card = (
      <div style={{
        width: '100%',
        height: '100%',
        background: 'linear-gradient(180deg, #f5f0e6 0%, #e8dec9 100%)',
        padding: 64,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'serif',
        color: '#1a3a2f'
      }}>
        {/* Brand header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 28, letterSpacing: '0.16em', fontWeight: 600 }}>
          <span>ROAM</span>
          <span style={{ opacity: 0.55, fontSize: 22, letterSpacing: '0.04em' }}>go-roam.uk</span>
        </div>

        {/* Title block */}
        <div style={{ marginTop: 48, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 32, color: '#5a7a6e', letterSpacing: '0.05em' }}>The places visited by</span>
          <span style={{ fontSize: 88, fontWeight: 600, lineHeight: 1, marginTop: 12 }}>{friendlyName}</span>
          <span style={{ fontSize: 30, color: '#5a7a6e', marginTop: 16 }}>
            {total} {total === 1 ? 'place' : 'places'} · {recommended} recommended
          </span>
        </div>

        {/* Map dots region */}
        <div style={{
          position: 'relative',
          flex: 1,
          marginTop: 36,
          marginBottom: 36,
          background: 'rgba(26, 58, 47, 0.04)',
          borderRadius: 28,
          display: 'flex'
        }}>
          {places.map((p, i) => {
            const x = ((p.lng - minLng) / lngRange) * 100
            const y = ((maxLat - p.lat) / latRange) * 100
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${x}%`,
                  top: `${y}%`,
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  background: dotColor(p.rating),
                  transform: 'translate(-50%, -50%)',
                  boxShadow: '0 0 14px rgba(26, 58, 47, 0.35)',
                  display: 'flex'
                }}
              />
            )
          })}
        </div>

        {/* Place names list (top 18) */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          fontSize: 22,
          color: 'rgba(26, 58, 47, 0.78)'
        }}>
          {topPlaces.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ width: 10, height: 10, borderRadius: 5, background: dotColor(p.rating), display: 'inline-block' }} />
              <span style={{ fontFamily: 'serif' }}>{p.name}</span>
            </div>
          ))}
          {places.length > topPlaces.length && (
            <div style={{ marginTop: 6, fontStyle: 'italic', color: 'rgba(26, 58, 47, 0.55)' }}>
              + {places.length - topPlaces.length} more
            </div>
          )}
        </div>
      </div>
    )

    const img = new ImageResponse(card, { width: 1200, height: 1700 })
    const buffer = Buffer.from(await img.arrayBuffer())
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Content-Disposition', `attachment; filename="${target.username}-roam-map.png"`)
    res.setHeader('Cache-Control', 'private, max-age=60')
    return res.status(200).send(buffer)
  } catch (err) {
    console.error('Poster render error', err)
    return res.status(500).json({ error: 'Failed to render poster' })
  }
}

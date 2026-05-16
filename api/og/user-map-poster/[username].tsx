/* eslint-disable react-refresh/only-export-components */
/* global Buffer */
/**
 * GET /api/og/user-map-poster/[username]
 *
 * 1200×1700 portrait poster of a user's visited places, rendered as a
 * branded field-journal artefact: cream parchment, compass rose,
 * vintage grid, numbered forest pins, dotted route between them, and
 * a footer roll-call of every place. Designed to feel like something
 * the user would actually frame, not a generic dashboard screenshot.
 *
 * Premium-gated (402 if the requesting owner isn't on ROAM+), owner-
 * only (403 for any other authed user). Renders via @vercel/og on the
 * Node runtime because mysql2 isn't edge-safe.
 *
 * Satori limitations called out inline where they bite:
 *   - display values: only flex / block / contents / none / -webkit-box
 *   - background-image patterns: limited; complex patterns drawn as
 *     inline SVG instead
 *   - external <img> resources: not used here (no tile imagery), so
 *     the renderer never blocks on network IO
 */

import { ImageResponse } from '@vercel/og'
import { queryOne, query } from '../../lib/db.js'
import { formatDisplayName } from '../../lib/displayName.js'
import { isPremiumRow } from '../../lib/premium.js'
import { getUserFromRequest } from '../../lib/auth.js'
import { applyRateLimit, RATE_LIMITS } from '../../lib/rateLimit.js'
import { withCors } from '../../lib/cors.js'

const FOREST = '#1a3a2f'
const FOREST_INK = '#0f2a22'
const CREAM = '#fdfcf8'
const PARCHMENT = '#f5f0e6'
const PARCHMENT_DEEP = '#ede2cc'
const GOLD = '#d4a855'
const TERRACOTTA = '#c45c3e'

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, 'og:user-map-poster')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const { username } = req.query
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username required' })
  }

  try {
    const target = await queryOne(
      `SELECT id, username, display_name, avatar_url, tier, subscription_expires_at, created_at
       FROM users
       WHERE username = ?`,
      [username]
    )
    if (!target) {
      return res.status(404).json({ error: 'Not found' })
    }
    const viewer = await getUserFromRequest(req)
    if (!viewer || viewer.id !== target.id) {
      return res.status(403).json({ error: 'You can only export your own map' })
    }
    if (!isPremiumRow(target)) {
      return res.status(402).json({
        error: 'premium_required',
        message: 'Map posters are a ROAM+ feature.',
        upgradeUrl: '/pricing',
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
      .map((r) => {
        const data = typeof r.place_data === 'string' ? JSON.parse(r.place_data) : r.place_data
        const lat = data?.lat
        const lng = data?.lng ?? data?.lon
        if (typeof lat !== 'number' || typeof lng !== 'number') return null
        return { lat, lng, name: data?.name || 'Unnamed place', rating: r.rating, visitedAt: r.visited_at }
      })
      .filter(Boolean)

    const total = places.length
    const recommended = places.filter((p) => p.rating != null && p.rating > 3).length
    const friendlyName = formatDisplayName(target)

    // Bounding box + project to a padded 0–100 % space so pins never
    // sit on the panel edge. Single-stop / colocated cases get a fake
    // span so projection doesn't divide by zero or collapse to 0,0.
    let minLat = 0, maxLat = 0, minLng = 0, maxLng = 0
    if (places.length > 0) {
      const lats = places.map((p) => p.lat)
      const lngs = places.map((p) => p.lng)
      minLat = Math.min(...lats); maxLat = Math.max(...lats)
      minLng = Math.min(...lngs); maxLng = Math.max(...lngs)
    }
    const latSpan = Math.max(maxLat - minLat, 0.01)
    const lngSpan = Math.max(maxLng - minLng, 0.01)
    const projected = places.map((p) => ({
      ...p,
      xPct: 8 + ((p.lng - minLng) / lngSpan) * 84, // 8–92 % horizontally
      yPct: 8 + ((maxLat - p.lat) / latSpan) * 84, // 8–92 % vertically (lat inverted)
    }))

    const dotColor = (rating) => {
      if (rating == null) return '#94a3b8'
      if (rating > 3) return FOREST
      return TERRACOTTA
    }

    const yearText = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    const topPlaces = projected.slice(0, 18)

    // Inline SVG grid lines + compass rose as decorative cartography.
    // Drawn as one full-panel SVG so satori's element budget stays small.
    const mapGrid = (
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        {/* Latitude lines */}
        {Array.from({ length: 9 }).map((_, i) => (
          <line
            key={`h${i}`}
            x1="0"
            x2="100"
            y1={(i + 1) * 10}
            y2={(i + 1) * 10}
            stroke={FOREST}
            strokeWidth="0.06"
            strokeDasharray="0.4 0.6"
            opacity="0.25"
          />
        ))}
        {/* Longitude lines */}
        {Array.from({ length: 9 }).map((_, i) => (
          <line
            key={`v${i}`}
            y1="0"
            y2="100"
            x1={(i + 1) * 10}
            x2={(i + 1) * 10}
            stroke={FOREST}
            strokeWidth="0.06"
            strokeDasharray="0.4 0.6"
            opacity="0.25"
          />
        ))}
      </svg>
    )

    // Dotted route polyline connecting pins in visit order.
    const routePolyline = projected.length > 1 && (
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        <polyline
          points={projected.map((p) => `${p.xPct.toFixed(2)},${p.yPct.toFixed(2)}`).join(' ')}
          fill="none"
          stroke={GOLD}
          strokeWidth="0.4"
          strokeDasharray="1.4 1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.85"
        />
      </svg>
    )

    // Compass rose — pure SVG, sits in the NE corner of the map panel.
    const compassRose = (
      <div
        style={{
          position: 'absolute',
          top: 28,
          right: 28,
          width: 110,
          height: 110,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="110" height="110" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="44" fill="none" stroke={FOREST} strokeWidth="1.2" opacity="0.55" />
          <circle cx="50" cy="50" r="38" fill="none" stroke={FOREST} strokeWidth="0.4" opacity="0.4" strokeDasharray="2 2" />
          {/* Star — N/S/E/W spikes */}
          <path d="M50 6 L54 50 L50 94 L46 50 Z" fill={FOREST} opacity="0.85" />
          <path d="M6 50 L50 46 L94 50 L50 54 Z" fill={GOLD} opacity="0.95" />
          <circle cx="50" cy="50" r="3" fill={CREAM} stroke={FOREST} strokeWidth="0.8" />
          {/* N label */}
          <text
            x="50"
            y="3"
            textAnchor="middle"
            dominantBaseline="hanging"
            fontFamily="serif"
            fontSize="8"
            fontWeight="700"
            fill={FOREST}
          >
            N
          </text>
        </svg>
      </div>
    )

    const card = (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: `linear-gradient(180deg, ${PARCHMENT} 0%, ${PARCHMENT_DEEP} 100%)`,
          padding: 72,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'serif',
          color: FOREST_INK,
          position: 'relative',
        }}
      >
        {/* Brand header — wordmark + small compass + url */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: 18,
            borderBottom: `1.5px solid ${FOREST}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke={FOREST} strokeWidth="1.6" />
              <path d="m16 7-1.8 5.4a2 2 0 0 1-1.3 1.3L7.4 16l1.8-5.4a2 2 0 0 1 1.3-1.3z" fill={GOLD} stroke={FOREST} strokeWidth="0.8" />
            </svg>
            <span style={{ fontSize: 30, letterSpacing: '0.16em', fontWeight: 600 }}>ROAM</span>
            <span style={{ fontSize: 22, letterSpacing: '0.18em', color: 'rgba(26, 58, 47, 0.55)', marginLeft: 14 }}>
              · A FIELD JOURNAL
            </span>
          </div>
          <span style={{ fontSize: 20, letterSpacing: '0.04em', color: 'rgba(26, 58, 47, 0.6)' }}>
            go-roam.uk
          </span>
        </div>

        {/* Hero title block */}
        <div style={{ marginTop: 48, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 30, color: '#5a7a6e', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            The places visited by
          </span>
          <span
            style={{
              fontSize: 96,
              fontWeight: 600,
              lineHeight: 1,
              marginTop: 14,
              letterSpacing: '-0.02em',
              fontFamily: 'serif',
            }}
          >
            {friendlyName}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 18 }}>
            <span style={{ fontSize: 26, color: '#5a7a6e' }}>
              {total} {total === 1 ? 'place' : 'places'}
            </span>
            <span style={{ fontSize: 26, color: 'rgba(26, 58, 47, 0.35)' }}>·</span>
            <span style={{ fontSize: 26, color: '#5a7a6e' }}>
              {recommended} recommended
            </span>
            <span style={{ fontSize: 26, color: 'rgba(26, 58, 47, 0.35)' }}>·</span>
            <span style={{ fontSize: 26, color: '#5a7a6e' }}>
              {yearText}
            </span>
          </div>
        </div>

        {/* MAP PANEL — the centrepiece. Cartographic feel without
            relying on tile imagery: parchment background, grid lines,
            compass rose, dotted route line, numbered pins, decorative
            double border. */}
        <div
          style={{
            position: 'relative',
            flex: 1,
            marginTop: 40,
            marginBottom: 40,
            background: 'rgba(26, 58, 47, 0.05)',
            borderRadius: 18,
            display: 'flex',
            overflow: 'hidden',
            boxShadow: `inset 0 0 0 2px ${CREAM}, inset 0 0 0 4px ${FOREST}, inset 0 0 0 6px ${CREAM}, inset 0 0 0 7px rgba(26, 58, 47, 0.4)`,
          }}
        >
          {mapGrid}
          {routePolyline}
          {compassRose}

          {/* Stamped "SCALE" marker in SW corner — feels like a real chart. */}
          <div
            style={{
              position: 'absolute',
              left: 28,
              bottom: 28,
              display: 'flex',
              flexDirection: 'column',
              fontSize: 16,
              color: 'rgba(26, 58, 47, 0.65)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            <span>Scale ☉ Field-relative</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ display: 'flex', width: 60, height: 4, background: FOREST }} />
              <span style={{ display: 'flex' }}>~ a day's roam</span>
            </span>
          </div>

          {/* Numbered pins — forest body + cream border, gold for the
              currently focused or most-recent visit. Numbering follows
              visit order (most recent = 1). */}
          {projected.map((p, i) => {
            const fill = dotColor(p.rating)
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${p.xPct}%`,
                  top: `${p.yPct}%`,
                  transform: 'translate(-50%, -50%)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                }}
              >
                {/* Pin body */}
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    background: fill,
                    border: `3px solid ${CREAM}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: `0 4px 10px rgba(26, 58, 47, 0.32)`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'serif',
                      fontSize: 18,
                      fontWeight: 700,
                      color: CREAM,
                      lineHeight: 1,
                    }}
                  >
                    {i + 1}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Legend row — what the pin colours mean */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 28,
            paddingBottom: 14,
            borderBottom: `1px solid rgba(26, 58, 47, 0.18)`,
            fontSize: 20,
            color: 'rgba(26, 58, 47, 0.75)',
            letterSpacing: '0.04em',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                display: 'flex',
                width: 14,
                height: 14,
                borderRadius: 7,
                background: FOREST,
              }}
            />
            <span>Recommended</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                display: 'flex',
                width: 14,
                height: 14,
                borderRadius: 7,
                background: '#94a3b8',
              }}
            />
            <span>Visited</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                display: 'flex',
                width: 14,
                height: 14,
                borderRadius: 7,
                background: TERRACOTTA,
              }}
            />
            <span>Not for me</span>
          </div>
        </div>

        {/* Places roll-call — numbered list matching the pin numbers */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 22,
            color: 'rgba(26, 58, 47, 0.82)',
            marginTop: 20,
          }}
        >
          {topPlaces.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span
                style={{
                  display: 'flex',
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  background: dotColor(p.rating),
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: CREAM,
                  fontSize: 13,
                  fontWeight: 700,
                  flexShrink: 0,
                  border: `1.5px solid ${CREAM}`,
                }}
              >
                {i + 1}
              </span>
              <span style={{ fontFamily: 'serif' }}>{p.name}</span>
            </div>
          ))}
          {places.length > topPlaces.length && (
            <div style={{ marginTop: 8, fontStyle: 'italic', color: 'rgba(26, 58, 47, 0.55)', fontSize: 20 }}>
              + {places.length - topPlaces.length} more places further afield
            </div>
          )}
        </div>

        {/* Footer band — branded tagline + URL */}
        <div
          style={{
            marginTop: 'auto',
            paddingTop: 24,
            borderTop: `1.5px solid ${FOREST}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 20,
            color: 'rgba(26, 58, 47, 0.72)',
            letterSpacing: '0.06em',
          }}
        >
          <span style={{ textTransform: 'uppercase' }}>Stop scrolling · Start roaming</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: GOLD }} />
            <span>An adventure record, exported from ROAM</span>
          </span>
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

export default withCors(handler)

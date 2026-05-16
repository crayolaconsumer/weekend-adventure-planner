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

    // Bounding box + map-tile projection ---------------------------
    //
    // satori renders an arbitrary number of <img> elements at render
    // time (it fetches each URL once), so we stitch a CARTO Voyager
    // tile grid behind the pins to give the poster real geographic
    // context. The same tile stack the Plan mini-map and Visited
    // Places map already use, so the visual identity is consistent.
    //
    // The route bounding box is padded by ~25 % per side so the map
    // shows some country/county context around the pins; pins are
    // then projected onto the same pixel grid as the tiles using a
    // standard slippy-map projection. Without this, single-cluster
    // routes would render with the pins clumped in the middle of a
    // mostly-empty map.

    const MAP_W = 1056 // poster inner width minus padding
    const MAP_H = 880  // map panel target height
    const TILE_SIZE = 256
    const TILES_WIDE = 5 // 1280 px tile-grid wide (covers MAP_W with overscan)
    const TILES_HIGH = 4 // 1024 px tile-grid tall

    const lng2tileFloat = (lng, z) => ((lng + 180) / 360) * Math.pow(2, z)
    const lat2tileFloat = (lat, z) => {
      const rad = (lat * Math.PI) / 180
      return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z)
    }

    let minLat = 0, maxLat = 0, minLng = 0, maxLng = 0
    if (places.length > 0) {
      const lats = places.map((p) => p.lat)
      const lngs = places.map((p) => p.lng)
      minLat = Math.min(...lats); maxLat = Math.max(...lats)
      minLng = Math.min(...lngs); maxLng = Math.max(...lngs)
    } else {
      // Empty maps default to a UK overview so the poster still has
      // a sensible map background. (The earlier 'no visited places'
      // guard could land before this, but defend against it anyway.)
      minLat = 50; maxLat = 55; minLng = -4; maxLng = 2
    }
    const latPad = Math.max(maxLat - minLat, 0.02) * 0.25
    const lngPad = Math.max(maxLng - minLng, 0.04) * 0.25
    const bMinLat = minLat - latPad
    const bMaxLat = maxLat + latPad
    const bMinLng = minLng - lngPad
    const bMaxLng = maxLng + lngPad
    const centerLat = (bMinLat + bMaxLat) / 2
    const centerLng = (bMinLng + bMaxLng) / 2

    // Pick the deepest zoom such that the padded bbox still fits in
    // a 3-tile x 2.5-tile area; that keeps the route prominent within
    // the 5x4 tile grid we render around it.
    let zoom = 14
    for (let z = 14; z >= 3; z--) {
      const xSpan = lng2tileFloat(bMaxLng, z) - lng2tileFloat(bMinLng, z)
      const ySpan = lat2tileFloat(bMinLat, z) - lat2tileFloat(bMaxLat, z)
      if (xSpan <= 3 && ySpan <= 2.5) { zoom = z; break }
      zoom = 3
    }

    const centerTileX = lng2tileFloat(centerLng, zoom)
    const centerTileY = lat2tileFloat(centerLat, zoom)
    const tileX0 = Math.floor(centerTileX - TILES_WIDE / 2)
    const tileY0 = Math.floor(centerTileY - TILES_HIGH / 2)

    // Pixel offset so the geographic centre lands at the panel centre.
    const centerOffsetX = (centerTileX - tileX0) * TILE_SIZE
    const centerOffsetY = (centerTileY - tileY0) * TILE_SIZE
    const translateX = MAP_W / 2 - centerOffsetX
    const translateY = MAP_H / 2 - centerOffsetY

    // Tile grid — array of { x, y, dx, dy } for the JSX map. Wraps
    // tile indices at the antimeridian so polar/oceanic routes still
    // render valid OSM tiles (defensive — UK users shouldn't hit it).
    const maxTileIdx = Math.pow(2, zoom)
    const tiles = []
    for (let dx = 0; dx < TILES_WIDE; dx++) {
      for (let dy = 0; dy < TILES_HIGH; dy++) {
        const tx = ((tileX0 + dx) % maxTileIdx + maxTileIdx) % maxTileIdx
        const ty = tileY0 + dy
        if (ty < 0 || ty >= maxTileIdx) continue
        tiles.push({ dx, dy, tx, ty })
      }
    }

    // Pin projection — same lat/lng → pixel maths as the tile grid
    // so pins land precisely on their location, not at an abstract
    // percentage of the panel.
    const projected = places.map((p) => {
      const pxX = (lng2tileFloat(p.lng, zoom) - tileX0) * TILE_SIZE + translateX
      const pxY = (lat2tileFloat(p.lat, zoom) - tileY0) * TILE_SIZE + translateY
      return { ...p, pxX, pxY }
    })

    const dotColor = (rating) => {
      if (rating == null) return '#94a3b8'
      if (rating > 3) return FOREST
      return TERRACOTTA
    }

    const yearText = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    const topPlaces = projected.slice(0, 18)

    // CARTO Voyager tile grid — stitched at render time. Satori fetches
    // each <img> URL in parallel so the poster ends up with a real
    // OSM map background. Voyager is the same style as ROAM's other
    // maps for visual continuity.
    const mapTiles = (
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: MAP_W,
          height: MAP_H,
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: translateX,
            top: translateY,
            width: TILES_WIDE * TILE_SIZE,
            height: TILES_HIGH * TILE_SIZE,
            display: 'flex',
          }}
        >
          {tiles.map(({ dx, dy, tx, ty }) => (
            <img
              key={`${dx}-${dy}`}
              src={`https://a.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${tx}/${ty}.png`}
              width={TILE_SIZE}
              height={TILE_SIZE}
              style={{
                position: 'absolute',
                left: dx * TILE_SIZE,
                top: dy * TILE_SIZE,
                width: TILE_SIZE,
                height: TILE_SIZE,
              }}
            />
          ))}
        </div>
        {/* Subtle parchment wash over the tiles so the brand palette
            stays present and the pins/route read against a unified
            warm tone instead of competing with bright tile colour. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(245,240,230,0.18) 0%, rgba(237,226,204,0.22) 100%)',
            display: 'flex',
          }}
        />
      </div>
    )

    // Route polyline — drawn over the tiles in pixel coordinates so
    // it aligns precisely with the pin positions. SVG covers the full
    // panel; the polyline is in pixel space, not percentage space.
    const routePolyline = projected.length > 1 && (
      <svg
        width={MAP_W}
        height={MAP_H}
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        style={{ position: 'absolute', left: 0, top: 0, width: MAP_W, height: MAP_H }}
      >
        <polyline
          points={projected.map((p) => `${p.pxX.toFixed(1)},${p.pxY.toFixed(1)}`).join(' ')}
          fill="none"
          stroke={GOLD}
          strokeWidth="5"
          strokeDasharray="12 14"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.92"
        />
      </svg>
    )

    // Compass rose — pure SVG body. Satori doesn't support <text>
    // nodes inside SVG ("convert them to <path>" — too much hassle for
    // a single letter), so the "N" label is rendered as a sibling HTML
    // span absolutely positioned above the rose.
    const compassRose = (
      <div
        style={{
          position: 'absolute',
          top: 28,
          right: 28,
          width: 120,
          height: 132,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
        }}
      >
        <span
          style={{
            display: 'flex',
            fontFamily: 'serif',
            fontSize: 18,
            fontWeight: 700,
            color: FOREST,
            letterSpacing: '0.08em',
            marginBottom: 4,
          }}
        >
          N
        </span>
        <svg width="110" height="110" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="44" fill="none" stroke={FOREST} strokeWidth="1.2" opacity="0.55" />
          <circle cx="50" cy="50" r="38" fill="none" stroke={FOREST} strokeWidth="0.4" opacity="0.4" strokeDasharray="2 2" />
          {/* Star — N/S/E/W spikes */}
          <path d="M50 6 L54 50 L50 94 L46 50 Z" fill={FOREST} opacity="0.85" />
          <path d="M6 50 L50 46 L94 50 L50 54 Z" fill={GOLD} opacity="0.95" />
          <circle cx="50" cy="50" r="3" fill={CREAM} stroke={FOREST} strokeWidth="0.8" />
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

        {/* MAP PANEL — real OSM tile map (CARTO Voyager) overlaid with
            a parchment wash, dotted gold route, numbered branded pins,
            compass rose, and decorative double-stroke field-journal
            border. Fixed pixel dimensions because the inner content
            (tiles, route polyline, pin pixel coords) is sized in real
            pixels so geographic alignment stays exact. */}
        <div
          style={{
            position: 'relative',
            width: MAP_W,
            height: MAP_H,
            marginTop: 40,
            marginBottom: 32,
            background: PARCHMENT,
            borderRadius: 18,
            display: 'flex',
            overflow: 'hidden',
            boxShadow: `inset 0 0 0 2px ${CREAM}, inset 0 0 0 4px ${FOREST}, inset 0 0 0 6px ${CREAM}, inset 0 0 0 7px rgba(26, 58, 47, 0.4)`,
          }}
        >
          {mapTiles}
          {routePolyline}
          {compassRose}

          {/* Stamped "SCALE" marker in SW corner — feels like a real
              chart. No glyphs that need an emoji font (satori falls
              back to a dynamic font fetch for chars like ☉ and that
              endpoint 400s reliably, killing the whole render). */}
          <div
            style={{
              position: 'absolute',
              left: 28,
              bottom: 28,
              display: 'flex',
              flexDirection: 'column',
              fontSize: 16,
              color: FOREST_INK,
              background: 'rgba(253, 252, 248, 0.78)',
              padding: '8px 12px',
              borderRadius: 8,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            <span>Scale · Field-relative</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ display: 'flex', width: 60, height: 4, background: FOREST }} />
              <span style={{ display: 'flex' }}>~ a day's roam</span>
            </span>
          </div>

          {/* Numbered pins — drawn in pixel coordinates that align
              with the underlying tile grid + route polyline. Pin body
              is forest by default; terracotta for "not-for-me" ratings;
              slate-grey for unrated visits. */}
          {projected.map((p, i) => {
            const fill = dotColor(p.rating)
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: p.pxX,
                  top: p.pxY,
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

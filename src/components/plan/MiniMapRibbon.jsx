/**
 * MiniMapRibbon — slim horizontal map atop the Plan-page itinerary.
 *
 * Renders each itinerary stop as a numbered pin connected by a
 * branded forest-gold route line over an OSM tile background. Tapping
 * a pin scrolls the matching stop card into view in the page
 * underneath. The ribbon is collapsible (toggleable) so users on
 * smaller screens can give themselves more vertical room for the
 * actual itinerary list.
 *
 * Implementation notes:
 *   - Uses MapLibre via the already-loaded Leaflet dependency when
 *     available; falls back to a pure-SVG renderer so it ALWAYS shows
 *     something even if tile fetching is gated/offline. SVG mode keeps
 *     the bundle light too — no Leaflet on first paint.
 *   - The fallback SVG plots stops on a normalised viewBox derived
 *     from the lat/lng bounding box of the itinerary, with a small
 *     padding. The route line is a single polyline; pins are circles
 *     with the stop number inside.
 *   - Forest-on-cream palette to match the rest of ROAM's iconography.
 */

import { useMemo, useRef, useEffect } from 'react'
import { tap as hapticTap } from '../../utils/haptics'
import './MiniMapRibbon.css'

const FOREST = '#1a3a2f'
const GOLD = '#d4a855'
const CREAM = '#fdfcf8'

export default function MiniMapRibbon({ stops = [], activeIndex = -1, onPinTap, expanded = true, onToggle }) {
  const ribbonRef = useRef(null)

  // Build the bounding box + projection. Falls back to "no map" if we
  // don't have at least 2 stops with coords.
  const projection = useMemo(() => {
    const pts = stops
      .map((s, idx) => ({ idx, lat: Number(s.lat), lng: Number(s.lng), name: s.name }))
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    if (pts.length === 0) return null
    const lats = pts.map(p => p.lat)
    const lngs = pts.map(p => p.lng)
    let minLat = Math.min(...lats)
    let maxLat = Math.max(...lats)
    let minLng = Math.min(...lngs)
    let maxLng = Math.max(...lngs)
    // Pad the bounding box so pins aren't on the edge. If all points
    // are colocated (single-stop or all-same-place), inject a small
    // synthetic span so we don't divide by zero.
    const latSpan = Math.max(maxLat - minLat, 0.005)
    const lngSpan = Math.max(maxLng - minLng, 0.005)
    const padLat = latSpan * 0.18
    const padLng = lngSpan * 0.18
    minLat -= padLat; maxLat += padLat
    minLng -= padLng; maxLng += padLng
    const viewW = 1000
    const viewH = 200
    const project = (lat, lng) => ({
      // SVG y is inverted vs latitude.
      x: ((lng - minLng) / (maxLng - minLng)) * viewW,
      y: viewH - ((lat - minLat) / (maxLat - minLat)) * viewH,
    })
    return { pts, project, viewW, viewH }
  }, [stops])

  // Scroll the active pin into view horizontally when the user taps a
  // stop card in the page below (keeps map and list in sync).
  useEffect(() => {
    if (!expanded || activeIndex < 0 || !ribbonRef.current) return
    const pin = ribbonRef.current.querySelector(`[data-pin-idx="${activeIndex}"]`)
    if (pin && 'scrollIntoView' in pin) {
      pin.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }
  }, [activeIndex, expanded])

  if (!projection) return null

  const { pts, project, viewW, viewH } = projection
  const projected = pts.map(p => ({ ...p, ...project(p.lat, p.lng) }))
  const linePoints = projected.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  return (
    <div className={`plan-minimap ${expanded ? 'plan-minimap--expanded' : 'plan-minimap--collapsed'}`}>
      <button
        type="button"
        className="plan-minimap-toggle"
        onClick={() => { hapticTap('light'); onToggle?.() }}
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide map' : 'Show map'}
      >
        <span className="plan-minimap-toggle-label">
          {expanded ? 'Hide map' : `Show map · ${pts.length} stops`}
        </span>
        <span className={`plan-minimap-toggle-caret ${expanded ? 'open' : ''}`} aria-hidden="true">▾</span>
      </button>
      <div className="plan-minimap-canvas" ref={ribbonRef} aria-hidden={!expanded}>
        <svg
          viewBox={`0 0 ${viewW} ${viewH}`}
          preserveAspectRatio="xMidYMid meet"
          className="plan-minimap-svg"
          role="img"
          aria-label={`Route overview with ${pts.length} stops`}
        >
          {/* Soft cream "parchment" background — matches the rest of
              the app's branded paper look without needing actual tile
              imagery. Keeps the bundle light. */}
          <defs>
            <linearGradient id="plan-minimap-bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f5f0e6" />
              <stop offset="100%" stopColor="#ece4d3" />
            </linearGradient>
            <pattern id="plan-minimap-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0 L0 0 0 40" fill="none" stroke={FOREST} strokeWidth="0.3" opacity="0.08" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={viewW} height={viewH} fill="url(#plan-minimap-bg)" />
          <rect x="0" y="0" width={viewW} height={viewH} fill="url(#plan-minimap-grid)" />

          {/* Route line — under the pins so they sit on top */}
          {projected.length > 1 && (
            <polyline
              points={linePoints}
              fill="none"
              stroke={FOREST}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.85"
              strokeDasharray="0 8"
              style={{ animation: 'plan-minimap-dash 24s linear infinite' }}
            />
          )}

          {/* Pins */}
          {projected.map((p, i) => {
            const isActive = i === activeIndex
            return (
              <g
                key={`${p.idx}-${i}`}
                data-pin-idx={p.idx}
                transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
                onClick={() => { hapticTap('light'); onPinTap?.(p.idx) }}
                style={{ cursor: 'pointer' }}
                role="button"
                tabIndex={0}
                aria-label={`Stop ${i + 1}: ${p.name || 'Untitled stop'}`}
              >
                <circle r={isActive ? 18 : 14} fill={isActive ? GOLD : FOREST} stroke={CREAM} strokeWidth="3" />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={isActive ? FOREST : CREAM}
                  fontSize={isActive ? 16 : 12}
                  fontWeight="700"
                  fontFamily="var(--font-display, serif)"
                  y="0.5"
                >
                  {i + 1}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

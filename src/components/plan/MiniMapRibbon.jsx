/**
 * MiniMapRibbon — at-a-glance route preview at the top of the Plan
 * page's itinerary. Branded forest + cream parchment palette to fit
 * ROAM's field-journal aesthetic.
 *
 * Layered architecture (so it works at every aspect ratio):
 *   1. SVG background with subtle grid texture + the route polyline.
 *      Uses preserveAspectRatio="none" so the route stretches to fill
 *      the canvas at any screen width without leaving empty bands.
 *   2. HTML pins absolutely-positioned over the SVG. Pins use
 *      percentages so they stay circular regardless of the canvas
 *      aspect ratio (an SVG <circle> would become an oval when the
 *      SVG is non-uniformly scaled by preserveAspectRatio="none").
 *
 * Component bails out cleanly if no stop has coords — the conditional
 * render in Plan.jsx already gates on itinerary.length > 0, but this
 * second guard means a half-rehydrated plan doesn't render an empty
 * grey box.
 */

import { useMemo, useRef, useEffect } from 'react'
import { tap as hapticTap } from '../../utils/haptics'
import './MiniMapRibbon.css'

const FOREST = '#1a3a2f'
const CREAM = '#fdfcf8'

export default function MiniMapRibbon({ stops = [], activeIndex = -1, onPinTap, expanded = true, onToggle }) {
  const ribbonRef = useRef(null)

  // Project lat/lng to a normalised 0–1 space inside a padded bounding
  // box. The padding (18% on each side) keeps pins off the canvas edge
  // on the visualisation; degenerate single-point cases get a fake
  // span injected so the projection doesn't divide by zero.
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
    const latSpan = Math.max(maxLat - minLat, 0.005)
    const lngSpan = Math.max(maxLng - minLng, 0.005)
    const padLat = latSpan * 0.18
    const padLng = lngSpan * 0.18
    minLat -= padLat; maxLat += padLat
    minLng -= padLng; maxLng += padLng
    const project = (lat, lng) => ({
      // Output in 0–1 space; the SVG viewBox and HTML pin layer both
      // expand from that with their own scaling math.
      xPct: (lng - minLng) / (maxLng - minLng),
      yPct: 1 - (lat - minLat) / (maxLat - minLat),
    })
    return { pts, project }
  }, [stops])

  // Scroll the active pin into view when the user taps a stop card
  // below — keeps map and list in sync without manual coordination.
  useEffect(() => {
    if (!expanded || activeIndex < 0 || !ribbonRef.current) return
    const pin = ribbonRef.current.querySelector(`[data-pin-idx="${activeIndex}"]`)
    if (pin && 'scrollIntoView' in pin) {
      pin.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }
  }, [activeIndex, expanded])

  if (!projection) return null

  const { pts, project } = projection
  const projected = pts.map(p => ({ ...p, ...project(p.lat, p.lng) }))
  // SVG viewBox is a unit square — preserveAspectRatio="none" stretches
  // it to fill the canvas. The route uses these unit coords; pin
  // positioning happens in CSS percentages of the wrapper instead.
  const linePoints = projected
    .map(p => `${(p.xPct * 100).toFixed(2)},${(p.yPct * 100).toFixed(2)}`)
    .join(' ')

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
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="plan-minimap-svg"
          role="img"
          aria-label={`Route overview with ${pts.length} stops`}
        >
          <defs>
            <pattern id="plan-minimap-grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M10 0 L0 0 0 10" fill="none" stroke={FOREST} strokeWidth="0.12" opacity="0.10" />
            </pattern>
          </defs>
          <rect x="0" y="0" width="100" height="100" fill="url(#plan-minimap-grid)" />
          {projected.length > 1 && (
            <polyline
              points={linePoints}
              fill="none"
              stroke={FOREST}
              strokeWidth="0.5"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.78"
              strokeDasharray="2 3"
            />
          )}
        </svg>

        {/* HTML pins layer — absolutely positioned at percentage
            coordinates so they stay circular regardless of the SVG
            canvas aspect ratio. */}
        <div className="plan-minimap-pins" aria-hidden={!expanded}>
          {projected.map((p, i) => {
            const isActive = i === activeIndex
            return (
              <button
                key={`${p.idx}-${i}`}
                type="button"
                data-pin-idx={p.idx}
                className={`plan-minimap-pin ${isActive ? 'active' : ''}`}
                style={{
                  left: `${(p.xPct * 100).toFixed(2)}%`,
                  top: `${(p.yPct * 100).toFixed(2)}%`,
                }}
                onClick={() => { hapticTap('light'); onPinTap?.(p.idx) }}
                aria-label={`Stop ${i + 1}: ${p.name || 'Untitled stop'}`}
                title={p.name || `Stop ${i + 1}`}
              >
                <span className="plan-minimap-pin-num" aria-hidden="true">{i + 1}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* "From → To" line under the map gives a clear textual anchor
          for users who can't parse the visualisation — and provides
          a low-cost-but-pleasant brand moment in the empty space. */}
      {expanded && pts.length > 1 && (
        <div className="plan-minimap-caption">
          <span className="plan-minimap-caption-from">{pts[0].name || 'Start'}</span>
          <span className="plan-minimap-caption-arrow" aria-hidden="true">→</span>
          <span className="plan-minimap-caption-to">{pts[pts.length - 1].name || 'End'}</span>
        </div>
      )}
    </div>
  )
}

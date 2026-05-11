/**
 * FilterIcon — stroked SVG icons for Discover filter extras + travel modes.
 *
 * Matches the inline-SVG style used throughout the app (CloseIcon,
 * RefreshIcon, etc.): 24x24 viewBox, stroke=currentColor, strokeWidth 2,
 * round line caps and joins. Inherits color from the surrounding text via
 * currentColor so a single icon set works on selected (white-on-color)
 * and unselected (dark-on-cream) filter chips without per-variant styling.
 *
 * Replaces these emojis previously used inline in FilterModal:
 *   Filter extras: 💸 ♿ 🕐 📍 ⏰
 *   Travel modes:  🚶 🚇 🚗 🗺️ 🧭
 *
 * Why not use CategoryIcon? CategoryIcon is the heavy medallion treatment
 * reserved for the place-category buttons (food/nature/etc.) — a brand
 * statement. These toggle filters and mode chips want a lighter visual
 * weight so the categories remain the visual anchor of the screen.
 *
 * Usage:
 *   <FilterIcon name="free" />
 *   <FilterIcon name="walking" size={20} />
 */

const DEFAULT_SIZE = 24

// Each icon is a paths-only fragment that goes inside a <svg> with shared
// styling. Keeping them as fragments (not full <svg> elements) lets us
// apply a single stroke / size definition in the wrapper below.

const ICONS = {
  // ─── Filter extras ──────────────────────────────────────────────

  /* Free — pound symbol inside a circle (UK pricing context). */
  free: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 16h6" />
      <path d="M14.5 8.5 a2.5 2.5 0 0 0 -4.5 1.5 v2 c0 1.5 -1 2 -1 2 h5" />
    </>
  ),

  /* Accessible — wheelchair pictogram (head + body + wheel). */
  accessibility: (
    <>
      <circle cx="13" cy="4.5" r="1.5" />
      <path d="M13 7 v6 h3 l2 4" />
      <circle cx="11" cy="17" r="4" />
      <path d="M11 13 v4" />
    </>
  ),

  /* Open now — clock with current-time hand. */
  'open-now': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7 v5 l3 2" />
    </>
  ),

  /* Locals' picks — pin with a heart inside. */
  'locals-picks': (
    <>
      <path d="M12 21 c-4 -5 -7 -8 -7 -12 a7 7 0 0 1 14 0 c0 4 -3 7 -7 12 z" />
      <path d="M9.5 10.5 a1.7 1.7 0 0 1 2.5 -1 1.7 1.7 0 0 1 2.5 1 c0 1.5 -2.5 3 -2.5 3 s -2.5 -1.5 -2.5 -3 z" fill="currentColor" stroke="none" />
    </>
  ),

  /* Off-peak — clock with a small "z" sleep mark in the corner. */
  'off-peak': (
    <>
      <circle cx="11" cy="13" r="8" />
      <path d="M11 8 v5 l3 2" />
      <path d="M17 4 h4 l-4 4 h4" />
    </>
  ),

  // ─── Travel modes ───────────────────────────────────────────────

  /* Walking — stick figure mid-stride. */
  walking: (
    <>
      <circle cx="13" cy="4.5" r="1.5" />
      <path d="M11 8 l1.5 3 -2 5 1 5" />
      <path d="M14.5 11 l3 1.5 1 4" />
      <path d="M10 13 l-2 4" />
    </>
  ),

  /* Transit — bus front (Capital Letter T was confusing, bus reads clearer). */
  transit: (
    <>
      <rect x="5" y="4" width="14" height="14" rx="2" />
      <path d="M5 12 h14" />
      <path d="M8 4 v-1" />
      <path d="M16 4 v-1" />
      <circle cx="8.5" cy="15" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15" r="1" fill="currentColor" stroke="none" />
      <path d="M6 20 l1 -2" />
      <path d="M18 20 l-1 -2" />
    </>
  ),

  /* Driving — car silhouette side view. */
  driving: (
    <>
      <path d="M3 14 v3 a1 1 0 0 0 1 1 h2 a2 2 0 0 0 4 0 h4 a2 2 0 0 0 4 0 h2 a1 1 0 0 0 1 -1 v-3 l-2 -5 a1 1 0 0 0 -1 -1 h-12 a1 1 0 0 0 -1 1 z" />
      <path d="M6 13 h12" />
    </>
  ),

  /* Day Trip — folded map. */
  dayTrip: (
    <>
      <path d="M3 6 l6 -2 6 2 6 -2 v14 l-6 2 -6 -2 -6 2 z" />
      <path d="M9 4 v16" />
      <path d="M15 6 v16" />
    </>
  ),

  /* Explorer — compass with N pointer. */
  explorer: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3 v2" />
      <path d="M12 19 v2" />
      <path d="M3 12 h2" />
      <path d="M19 12 h2" />
      <path d="M12 8 l3 8 -3 -2 -3 2 z" fill="currentColor" stroke="none" />
    </>
  ),
}

// Plan.jsx uses shorter keys (walk/drive) for its TRANSPORT_MODES;
// Discover.jsx uses walking/driving for its TRAVEL_MODES. Aliases let
// either callsite pass its own key without per-call mapping.
const ALIASES = {
  walk: 'walking',
  drive: 'driving',
}

export default function FilterIcon({
  name,
  size = DEFAULT_SIZE,
  className = '',
  title,
  strokeWidth = 2,
}) {
  const resolved = ALIASES[name] || name
  const paths = ICONS[resolved]
  if (!paths) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {paths}
    </svg>
  )
}

/**
 * FilterIcon — stroked SVG icons for Discover filter extras + travel modes.
 *
 * Paths adapted from Lucide (ISC licensed, https://lucide.dev) which is
 * the standard stroke-icon set used across the React ecosystem. They
 * render cleanly at every size we use (18-28px) because each path is
 * tuned for 24x24 with a 2px stroke.
 *
 * Inherits color via currentColor so a single icon set works on
 * selected (white-on-color) and unselected (dark-on-cream) filter
 * chips without per-variant styling.
 *
 * Usage:
 *   <FilterIcon name="free" />
 *   <FilterIcon name="walking" size={20} />
 */

const DEFAULT_SIZE = 24

const ICONS = {
  // ─── Filter extras ──────────────────────────────────────────────

  /* Free — Lucide "pound-sterling" inside a circle. Clear UK pricing semantics. */
  free: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h6" />
      <path d="M9 16V9.5a2.5 2.5 0 0 1 5 0" />
      <path d="M9 16h6" />
    </>
  ),

  /* Accessibility — Lucide "accessibility". Person in wheelchair pictogram. */
  accessibility: (
    <>
      <circle cx="16" cy="4" r="1" />
      <path d="m18 19 1-7-5.87.94" />
      <path d="m5 8 3-3 5.5 3-2.21 3.1" />
      <path d="M4.24 14.5a5 5 0 0 0 6.88 6" />
      <path d="M13.76 17.5a5 5 0 0 0-6.88-6" />
    </>
  ),

  /* Open now — Lucide "clock". Outline circle + two hands. */
  'open-now': (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),

  /* Locals' picks — Lucide "map-pin-heart". Pin with heart inside. */
  'locals-picks': (
    <>
      <path d="M19.5 9.5C19.5 14 12 21.5 12 21.5S4.5 14 4.5 9.5a7.5 7.5 0 0 1 15 0Z" />
      <path d="M11.95 12.5a2 2 0 0 1-1.36-3.45 2 2 0 0 1 2.74-.09 2 2 0 0 1 2.74.09 2 2 0 0 1-1.36 3.45" />
    </>
  ),

  /* Off-peak — Lucide "moon". Crescent. Reads as "quieter time". */
  'off-peak': (
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  ),

  // ─── Travel modes ───────────────────────────────────────────────

  /* Walking — Material Design "directions_walk" silhouette. Filled,
      not stroked, so it overrides the wrapper svg's fill="none" /
      stroke="currentColor" defaults. Single compound path: head circle
      + walking body in one statement. */
  walking: (
    <path
      fill="currentColor"
      stroke="none"
      d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"
    />
  ),

  /* Transit — Lucide "bus-front". Friendly bus pictogram. */
  transit: (
    <>
      <path d="M4 6 2 7" />
      <path d="M10 6h4" />
      <path d="m22 7-2-1" />
      <rect x="4" y="3" width="16" height="17" rx="2" />
      <path d="M4 11h16" />
      <path d="M8 15h.01" />
      <path d="M16 15h.01" />
      <path d="M6 19v2" />
      <path d="M18 21v-2" />
    </>
  ),

  /* Driving — Lucide "car". Side view with two wheels. */
  driving: (
    <>
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
      <circle cx="7" cy="17" r="2" />
      <path d="M9 17h6" />
      <circle cx="17" cy="17" r="2" />
    </>
  ),

  /* Day Trip — Lucide "map". Folded map with three panels. */
  dayTrip: (
    <>
      <path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" />
      <path d="M15 5.764v15" />
      <path d="M9 3.236v15" />
    </>
  ),

  /* Explorer — Lucide "compass". Outer ring + diamond needle. */
  explorer: (
    <>
      <path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" />
      <circle cx="12" cy="12" r="10" />
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

/**
 * VibeIcon — stroked SVG icons for Plan-page adventure vibes.
 *
 * Replaces the four 🎲 / 🍽️ / 🏛️ / 🌲 emojis that used to live in
 * VIBE_ICONS so the Plan surface matches the rest of ROAM's bespoke
 * iconography instead of rendering whatever each platform's emoji
 * set looks like (Android's, in particular, are wildly inconsistent
 * across vendors and OS versions).
 *
 * Inherits color via currentColor so a single icon set works on
 * selected (white on forest) and unselected (forest on cream) chip
 * states without per-variant styling.
 *
 * Usage:
 *   <VibeIcon name="mixed" size={20} />
 *   <VibeIcon name={selectedVibe} size={32} />
 */

const DEFAULT_SIZE = 24

const ICONS = {
  /* Mixed — die with five pips. Matches the "I'm Bored" dice button
     in DiscoverHeader for visual continuity (shuffle / serendipity). */
  mixed: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" opacity="0.18" />
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="8" cy="16" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),

  /* Foodie — Lucide "utensils-crossed". Fork + knife, food semantics. */
  foodie: (
    <>
      <path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8" />
      <path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6L15 21l2.3-2.3a4.2 4.2 0 0 0 0-6" />
      <path d="m2.1 21.8 6.4-6.3" />
      <path d="m19 5-7 7" />
    </>
  ),

  /* Culture — Lucide "landmark". Classical portico with columns. */
  culture: (
    <>
      <line x1="3" y1="22" x2="21" y2="22" />
      <line x1="6" y1="18" x2="6" y2="11" />
      <line x1="10" y1="18" x2="10" y2="11" />
      <line x1="14" y1="18" x2="14" y2="11" />
      <line x1="18" y1="18" x2="18" y2="11" />
      <polygon points="12 2 20 7 4 7" />
    </>
  ),

  /* Nature — Lucide "trees". A simple pine silhouette. */
  nature: (
    <>
      <path d="M10 10v.2A3 3 0 0 1 8.9 16H5l-.6-.4a2 2 0 0 1-.4-2.4l1.5-2.6A2 2 0 0 1 7.2 10H10Z" />
      <path d="M7 16v6" />
      <path d="M13 19v3" />
      <path d="M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5" />
    </>
  ),
}

export default function VibeIcon({
  name,
  size = DEFAULT_SIZE,
  className = '',
  title,
  strokeWidth = 2,
}) {
  const paths = ICONS[name]
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

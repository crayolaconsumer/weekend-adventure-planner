/**
 * SettingsIcon — small line-icons for settings toggles + filter pills.
 *
 * Same line-style language as RatingIcon: 24x24 viewBox, currentColor
 * stroke at 1.6, round caps. Inherits the toggle's text color so it
 * dims naturally when a toggle is inactive.
 *
 * Used in UnifiedProfile settings tab + discover filter modal.
 *
 * Usage:
 *   <SettingsIcon name="bell" size={20} />
 *   <SettingsIcon name="accessibility" />
 */

const ICONS = {
  /* Free entry — banknote with sparkle */
  free: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="18" height="11" rx="1.5" />
      <circle cx="12" cy="12.5" r="2.5" />
      <path d="M5.5 9.5 v0.01 M18.5 15.5 v0.01" />
    </g>
  ),

  /* Wheelchair accessible pictogram */
  accessibility: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7 v4 l-3 3 5 0 1 5" />
      <circle cx="13" cy="17" r="4" />
    </g>
  ),

  /* Clock — open hours */
  clock: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7 v5 l3 2" />
    </g>
  ),

  /* Bell — notifications */
  bell: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 16 v-4 a6 6 0 0 1 12 0 v4 l1.5 2 h-15 z" />
      <path d="M10 20 a2 2 0 0 0 4 0" />
    </g>
  ),

  /* Upvote — thumbs up / arrow trending up */
  upvote: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 12 v8 h-3 a1 1 0 0 1 -1 -1 v-7 z" />
      <path d="M9 12 l4 -8 a2 2 0 0 1 2 -1 a1.5 1.5 0 0 1 1.5 1.8 l-1 4.7 h5 a1.5 1.5 0 0 1 1.5 1.7 l-1 7 a2 2 0 0 1 -2 1.8 h-7 v-8 z" />
    </g>
  ),

  /* Map — folded paper map (plans) */
  map: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6 l6 -2 6 2 6 -2 v14 l-6 2 -6 -2 -6 2 z" />
      <path d="M9 4 v16" />
      <path d="M15 6 v16" />
    </g>
  ),

  /* Envelope — digest / email */
  digest: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="13" rx="1.5" />
      <path d="M3 7 l9 7 9 -7" />
    </g>
  ),

  /* Calendar — visit reminder */
  calendar: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 10 h17" />
      <path d="M8 3 v4 M16 3 v4" />
      {/* Tiny dot — "today" */}
      <circle cx="8" cy="14" r="1" fill="currentColor" />
      <circle cx="12" cy="14" r="1" fill="currentColor" />
      <circle cx="16" cy="14" r="1" fill="currentColor" />
    </g>
  ),
}

const FALLBACK = (
  <circle cx="12" cy="12" r="3" fill="currentColor" />
)

export default function SettingsIcon({
  name,
  size = 20,
  className = '',
  title,
}) {
  const illustration = ICONS[name] || FALLBACK
  return (
    <span
      className={`settings-icon settings-icon-${name} ${className}`}
      role="img"
      aria-label={title || name}
      style={{ display: 'inline-flex', width: `${size}px`, height: `${size}px`, flexShrink: 0 }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        aria-hidden="true"
      >
        {illustration}
      </svg>
    </span>
  )
}

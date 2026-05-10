/**
 * RatingIcon — small inline line-icons for vibe / noise / value chips.
 *
 * Different visual treatment from the medallion icons (CategoryIcon,
 * AchievementBadge): these are SMALL — 16-20px — and live inside chip
 * pills with text, so they need to be:
 *   - line-style at currentColor (inherits chip text colour)
 *   - simple silhouettes that read at 16px
 *   - no rim, no field, no fill — pure stroke
 *
 * Used in VisitedPrompt (review entry) + PlaceReviews (review display).
 *
 * Usage:
 *   <RatingIcon kind="vibe" value="relaxed" size={20} />
 *   <RatingIcon kind="noise" value="quiet" />
 *   <RatingIcon kind="value" value="great" />
 */

const ICONS = {
  /* ── Vibes ──────────────────────────────────────────────────── */
  'vibe.relaxed': (
    /* Steaming cup of tea — calm, slow */
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {/* Cup */}
      <path d="M5 11 h11 v5 a4 4 0 0 1 -4 4 h-3 a4 4 0 0 1 -4 -4 z" />
      {/* Handle */}
      <path d="M16 13 a3 3 0 0 1 0 5" />
      {/* Steam */}
      <path d="M8 4 q1 1.5 0 3 q-1 1.5 0 3" />
      <path d="M11.5 4 q1 1.5 0 3 q-1 1.5 0 3" />
    </g>
  ),
  'vibe.lively': (
    /* Sparkles cluster — energetic, social */
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4 v3 M12 17 v3 M4 12 h3 M17 12 h3" />
      <path d="M6.5 6.5 l2 2 M15.5 15.5 l2 2 M17.5 6.5 l-2 2 M6.5 17.5 l2 -2" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    </g>
  ),
  'vibe.romantic': (
    /* Heart — single line, asymmetric for hand-drawn feel */
    <path
      d="M12 20 c-5 -3.5 -8 -7 -8 -10.5 a4 4 0 0 1 8 -1.5 a4 4 0 0 1 8 1.5 c0 3.5 -3 7 -8 10.5 z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
  ),
  'vibe.family': (
    /* Three figures grouped — family-friendly */
    <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Adult left */}
      <circle cx="6.5" cy="8" r="2" />
      <path d="M3.5 17 v-3 a3 3 0 0 1 6 0 v3" />
      {/* Adult right */}
      <circle cx="17.5" cy="8" r="2" />
      <path d="M14.5 17 v-3 a3 3 0 0 1 6 0 v3" />
      {/* Child centre */}
      <circle cx="12" cy="11" r="1.5" />
      <path d="M10 19 v-2 a2 2 0 0 1 4 0 v2" />
    </g>
  ),

  /* ── Noise ──────────────────────────────────────────────────── */
  'noise.quiet': (
    /* Muted speaker + slash */
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9 v6 h3 l5 4 v-14 l-5 4 z" fill="currentColor" />
      <path d="M16 9 l4 6 M20 9 l-4 6" />
    </g>
  ),
  'noise.moderate': (
    /* Speaker with one wave — moderate volume */
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9 v6 h3 l5 4 v-14 l-5 4 z" fill="currentColor" />
      <path d="M16 10 a3 3 0 0 1 0 4" />
    </g>
  ),
  'noise.loud': (
    /* Speaker with two waves — loud */
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9 v6 h3 l5 4 v-14 l-5 4 z" fill="currentColor" />
      <path d="M16 10 a3 3 0 0 1 0 4" />
      <path d="M19 7 a7 7 0 0 1 0 10" />
    </g>
  ),

  /* ── Value ──────────────────────────────────────────────────── */
  'value.great': (
    /* Coin with check — great value */
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8" />
      <path d="M8.5 12 l2.5 2.5 4.5 -5" />
    </g>
  ),
  'value.fair': (
    /* Balance scales — fair price */
    <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Beam + post */}
      <path d="M12 5 v15" />
      <path d="M5 9 h14" />
      <path d="M8 19 h8" />
      {/* Pans (flattened triangles) */}
      <path d="M2.5 9 l2.5 5 2.5 -5 z" fill="currentColor" opacity="0.18" />
      <path d="M16.5 9 l2.5 5 2.5 -5 z" fill="currentColor" opacity="0.18" />
      <path d="M2.5 9 l2.5 5 2.5 -5 z" />
      <path d="M16.5 9 l2.5 5 2.5 -5 z" />
    </g>
  ),
  'value.expensive': (
    /* Stack of three coins — pricey */
    <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="6" rx="6" ry="2" />
      <path d="M6 6 v3 a6 2 0 0 0 12 0 v-3" />
      <path d="M6 11 v3 a6 2 0 0 0 12 0 v-3" />
      <path d="M6 16 v3 a6 2 0 0 0 12 0 v-3" />
    </g>
  ),
}

/* Fallback: small filled dot */
const FALLBACK = <circle cx="12" cy="12" r="3" fill="currentColor" />

export default function RatingIcon({
  kind,
  value,
  size = 20,
  className = '',
  title,
}) {
  const key = `${kind}.${value}`
  const illustration = ICONS[key] || FALLBACK

  return (
    <span
      className={`rating-icon rating-icon-${kind} ${className}`}
      role="img"
      aria-label={title || value || kind}
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

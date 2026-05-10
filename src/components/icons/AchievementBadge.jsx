/**
 * AchievementBadge — branded merit-badge SVG for ROAM achievements.
 *
 * Each badge is a proper scout-merit-badge: 12-point serrated gold rim,
 * forest green inner field, subtle gold bevel, gold central illustration.
 * Matches PremiumBadge's identity — these read as a *set* of earned stamps
 * in a travel journal, not generic icons.
 *
 * Routes by badge ID (the canonical IDs from BADGES + SERVER_BADGE_CONFIG
 * in UnifiedProfile.jsx). Unknown IDs fall back to a generic medallion star.
 *
 * Locked state: desaturated forest field + lock illustration, no gold rim
 * highlights. Visually marks "not earned yet" without being depressing.
 *
 * Usage:
 *   <AchievementBadge id="first_adventure" size={64} />
 *   <AchievementBadge id="streak_30" size="lg" />
 *   <AchievementBadge id="streak_30" size="sm" locked />
 */

const SIZE_PRESETS = {
  xs: 28,
  sm: 40,
  md: 56,
  lg: 72,
  xl: 96,
  hero: 128,
}

const FOREST = '#1a3a2f'
const FOREST_DIM = '#3d4f48'
const GOLD = '#d4a855'
const GOLD_DIM = '#9a8a72'
const CREAM = '#fdfcf8'
const STONE = '#8a8478'

/* 12-point serrated outer rim — same proportions as PremiumBadge,
   scaled up to 64x64 viewBox. */
const RIM_POINTS_64 =
  '32,0.8 44.8,9.2 56,5.6 60,18.4 63.2,32 60,45.6 56,58.4 44.8,54.8 32,63.2 19.2,54.8 8,58.4 4,45.6 0.8,32 4,18.4 8,5.6 19.2,9.2'

/**
 * Each illustration is centered at (32, 32) and lives roughly within
 * a 28x28 bounding box. Drawn in gold (#d4a855) with optional cream
 * accents for depth where it helps legibility.
 */
const ILLUSTRATIONS = {
  /* ── Discovery / Exploration ─────────────────────────────────── */

  // First adventure: sapling — two leaves on a curved stem
  first_adventure: (
    <g fill={GOLD}>
      {/* Stem */}
      <path d="M32 44 c0 -6 0.4 -12 1 -16" stroke={GOLD} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      {/* Left leaf */}
      <path d="M32 36 c-4 -3 -9 -3 -10 1 c0 3 4 4 7 2 c2 -1 3 -2 3 -3 z" />
      {/* Right leaf */}
      <path d="M33 30 c4 -3 9 -3 10 1 c0 3 -4 4 -7 2 c-2 -1 -3 -2 -3 -3 z" />
      {/* Tiny ground line */}
      <path d="M27 46 h10" stroke={GOLD} strokeWidth="1" strokeLinecap="round" opacity="0.6" />
    </g>
  ),

  // Explorer (5 places): compass needle pointing N
  explorer_5: (
    <g>
      {/* Outer compass ring */}
      <circle cx="32" cy="32" r="12" fill="none" stroke={GOLD} strokeWidth="1.4" />
      {/* North needle (gold) */}
      <polygon points="32,22 34,32 30,32" fill={GOLD} />
      {/* South needle (cream for contrast) */}
      <polygon points="32,42 34,32 30,32" fill={CREAM} />
      {/* Centre pip */}
      <circle cx="32" cy="32" r="1.4" fill={CREAM} />
      {/* Tiny N marker */}
      <text x="32" y="20" fontSize="5" fill={GOLD} textAnchor="middle" fontFamily="serif" fontWeight="700">N</text>
    </g>
  ),
  // first_visit is functionally the same — alias to explorer_5
  first_visit: 'alias:explorer_5',

  // Pathfinder (25 places): rolled map scroll with X
  explorer_25: (
    <g fill={GOLD}>
      {/* Scroll body */}
      <rect x="20" y="22" width="24" height="20" rx="1" />
      {/* Left + right roll caps (cream for depth) */}
      <rect x="18" y="20" width="4" height="24" rx="2" fill={GOLD} />
      <rect x="42" y="20" width="4" height="24" rx="2" fill={GOLD} />
      {/* Surface darkening */}
      <rect x="22" y="22" width="20" height="20" fill={FOREST} opacity="0.35" />
      {/* X marker */}
      <path d="M28 28 L36 36 M36 28 L28 36" stroke={GOLD} strokeWidth="2" strokeLinecap="round" />
      {/* Tiny destination dot */}
      <circle cx="32" cy="32" r="0.9" fill={CREAM} />
    </g>
  ),
  // visits_10 (Adventurer) — same map metaphor at smaller milestone
  visits_10: 'alias:explorer_25',

  // Wanderer / Seasoned Traveler / World Wanderer: globe with longitudes
  explorer_100: (
    <g>
      {/* Globe outline */}
      <circle cx="32" cy="32" r="13" fill="none" stroke={GOLD} strokeWidth="1.6" />
      {/* Equator */}
      <line x1="19" y1="32" x2="45" y2="32" stroke={GOLD} strokeWidth="1.2" />
      {/* Meridians (curved ellipses) */}
      <ellipse cx="32" cy="32" rx="5" ry="13" fill="none" stroke={GOLD} strokeWidth="1.2" />
      <ellipse cx="32" cy="32" rx="11" ry="13" fill="none" stroke={GOLD} strokeWidth="0.9" opacity="0.7" />
      {/* Tropics */}
      <line x1="22" y1="26" x2="42" y2="26" stroke={GOLD} strokeWidth="0.7" opacity="0.6" />
      <line x1="22" y1="38" x2="42" y2="38" stroke={GOLD} strokeWidth="0.7" opacity="0.6" />
    </g>
  ),
  visits_50: 'alias:explorer_100',
  // World Wanderer: globe with extra star
  visits_100: (
    <g>
      <circle cx="32" cy="32" r="11" fill="none" stroke={GOLD} strokeWidth="1.6" />
      <line x1="21" y1="32" x2="43" y2="32" stroke={GOLD} strokeWidth="1.1" />
      <ellipse cx="32" cy="32" rx="4" ry="11" fill="none" stroke={GOLD} strokeWidth="1.1" />
      <ellipse cx="32" cy="32" rx="9" ry="11" fill="none" stroke={GOLD} strokeWidth="0.7" opacity="0.7" />
      {/* Wandering star at NE */}
      <path d="M44 18 L45.4 21 L48.4 22 L45.4 23 L44 26 L42.6 23 L39.6 22 L42.6 21 Z" fill={GOLD} />
    </g>
  ),

  /* ── Streaks / Energy ────────────────────────────────────────── */

  // Getting Into It (3-day streak): flame
  streak_3: (
    <g fill={GOLD}>
      <path d="M32 18 c-1 4 -7 6 -7 14 c0 7 6 12 12 12 c6 0 11 -5 11 -11 c0 -3 -1 -6 -3 -9 c-1 2 -3 3 -5 3 c0 -4 -3 -7 -8 -9 z" />
      {/* Inner ember (cream) */}
      <path d="M32 32 c-1 2 -3 4 -3 6 c0 3 2 5 5 5 c3 0 5 -2 5 -5 c0 -2 -2 -4 -4 -5 c-1 -1 -2 -1 -3 -1 z" fill={CREAM} opacity="0.85" />
    </g>
  ),

  // Week Warrior (7-day streak): lightning bolt
  streak_7: (
    <path
      d="M36 16 L24 36 L31 36 L29 48 L42 28 L34 28 L37 16 Z"
      fill={GOLD}
    />
  ),

  // Unstoppable (30-day streak): mountain peak with summit flag
  streak_30: (
    <g>
      {/* Back peak */}
      <path d="M16 46 L26 28 L36 46 Z" fill={GOLD} opacity="0.55" />
      {/* Front peak with snowcap */}
      <path d="M24 46 L36 22 L48 46 Z" fill={GOLD} />
      <path d="M36 22 L40 28 L36 30 L32 28 Z" fill={CREAM} />
      {/* Summit flag pole */}
      <line x1="36" y1="22" x2="36" y2="14" stroke={GOLD} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M36 14 L43 16 L36 18 Z" fill={GOLD} />
    </g>
  ),

  /* ── Behaviour ───────────────────────────────────────────────── */

  // Spontaneous (Just Go x10): bullseye with arrow
  just_go: (
    <g>
      <circle cx="32" cy="32" r="12" fill="none" stroke={GOLD} strokeWidth="1.6" />
      <circle cx="32" cy="32" r="7" fill="none" stroke={GOLD} strokeWidth="1.4" />
      <circle cx="32" cy="32" r="3" fill={GOLD} />
      {/* Arrow shaft on diagonal */}
      <line x1="42" y1="20" x2="34" y2="30" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" />
      {/* Arrowhead */}
      <path d="M32 32 L36 28 L34 30 L36 32 Z" fill={GOLD} />
      <path d="M44 18 L40 20 L42 22 Z" fill={GOLD} />
    </g>
  ),

  // Curator: stack of books
  curator: (
    <g fill={GOLD}>
      <rect x="18" y="40" width="28" height="6" rx="0.5" />
      <rect x="20" y="32" width="24" height="6" rx="0.5" />
      <rect x="22" y="24" width="20" height="6" rx="0.5" />
      {/* Spine details (cream) */}
      <line x1="22" y1="42" x2="42" y2="42" stroke={FOREST} strokeWidth="0.7" opacity="0.6" />
      <line x1="24" y1="34" x2="40" y2="34" stroke={FOREST} strokeWidth="0.7" opacity="0.6" />
      <line x1="26" y1="26" x2="38" y2="26" stroke={FOREST} strokeWidth="0.7" opacity="0.6" />
    </g>
  ),

  // Planner: clipboard with checkmark
  planner: (
    <g>
      {/* Clipboard back */}
      <rect x="20" y="22" width="24" height="24" rx="2" fill={GOLD} />
      {/* Clip on top */}
      <rect x="28" y="18" width="8" height="6" rx="1" fill={GOLD} />
      {/* Page */}
      <rect x="22" y="24" width="20" height="20" rx="1" fill={FOREST} opacity="0.45" />
      {/* Check mark */}
      <path
        d="M26 34 L30 38 L38 28"
        fill="none"
        stroke={CREAM}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  ),

  /* ── Contribution ────────────────────────────────────────────── */

  // First contribution: quill / feather pen
  first_contribution: (
    <g>
      {/* Feather body */}
      <path
        d="M44 18 c-8 2 -16 8 -22 16 c-2 3 -3 6 -3 8 l4 -4 c4 -5 10 -10 17 -13 c2 -1 4 -3 4 -7 z"
        fill={GOLD}
      />
      {/* Feather barbs (subtle) */}
      <path
        d="M28 38 c2 -2 4 -4 6 -5 M24 42 c2 -2 4 -4 6 -5"
        stroke={FOREST}
        strokeWidth="0.7"
        opacity="0.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Nib */}
      <path d="M19 42 L17 46 L21 44 Z" fill={CREAM} />
      {/* Ink dot */}
      <circle cx="20" cy="46" r="1.4" fill={GOLD} />
    </g>
  ),

  // Local Expert (10 contributions): scroll with text lines
  contributor_10: (
    <g>
      <rect x="20" y="22" width="24" height="20" rx="1.5" fill={GOLD} />
      <rect x="22" y="24" width="20" height="16" fill={FOREST} opacity="0.45" />
      {/* Text lines */}
      <line x1="24" y1="28" x2="40" y2="28" stroke={CREAM} strokeWidth="1.2" strokeLinecap="round" />
      <line x1="24" y1="32" x2="38" y2="32" stroke={CREAM} strokeWidth="1.2" strokeLinecap="round" />
      <line x1="24" y1="36" x2="36" y2="36" stroke={CREAM} strokeWidth="1.2" strokeLinecap="round" />
      {/* Little signature flourish */}
      <path d="M26 40 c2 0 3 -1 4 -2" stroke={GOLD} strokeWidth="1" strokeLinecap="round" fill="none" />
    </g>
  ),

  // Community Pillar (50 contributions): Greek column
  contributor_50: (
    <g fill={GOLD}>
      {/* Capital */}
      <rect x="22" y="20" width="20" height="3" />
      <rect x="20" y="23" width="24" height="2" />
      {/* Shaft (with vertical fluting suggested by inner forest stripes) */}
      <rect x="24" y="25" width="16" height="20" />
      <line x1="28" y1="25" x2="28" y2="45" stroke={FOREST} strokeWidth="0.6" opacity="0.6" />
      <line x1="32" y1="25" x2="32" y2="45" stroke={FOREST} strokeWidth="0.6" opacity="0.6" />
      <line x1="36" y1="25" x2="36" y2="45" stroke={FOREST} strokeWidth="0.6" opacity="0.6" />
      {/* Base */}
      <rect x="22" y="45" width="20" height="2" />
      <rect x="20" y="47" width="24" height="3" />
    </g>
  ),

  /* ── Social ──────────────────────────────────────────────────── */

  // Rising Star (10 followers): star with motion arc
  followers_10: (
    <g>
      {/* Motion arc trailing star */}
      <path
        d="M14 44 q6 -8 16 -10"
        fill="none"
        stroke={GOLD}
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.55"
        strokeDasharray="2 2"
      />
      {/* 5-point star */}
      <path
        d="M36 18 L39 28 L49 28 L41 34 L44 44 L36 38 L28 44 L31 34 L23 28 L33 28 Z"
        fill={GOLD}
      />
      {/* Inner highlight */}
      <circle cx="36" cy="32" r="2" fill={CREAM} opacity="0.6" />
    </g>
  ),

  // Influencer (100 followers): crown
  followers_100: (
    <g>
      {/* Crown band */}
      <rect x="18" y="38" width="28" height="8" rx="1" fill={GOLD} />
      {/* Crown points */}
      <path
        d="M18 38 L21 22 L25 32 L32 18 L39 32 L43 22 L46 38 Z"
        fill={GOLD}
      />
      {/* Jewels */}
      <circle cx="21" cy="22" r="1.6" fill={CREAM} />
      <circle cx="32" cy="18" r="1.8" fill={CREAM} />
      <circle cx="43" cy="22" r="1.6" fill={CREAM} />
      {/* Band texture */}
      <line x1="20" y1="42" x2="44" y2="42" stroke={FOREST} strokeWidth="0.6" opacity="0.5" />
    </g>
  ),
}

/* Generic medallion fallback for unknown IDs */
const FALLBACK = (
  <g>
    <path
      d="M32 18 L34.5 28.5 L45 32 L34.5 35.5 L32 46 L29.5 35.5 L19 32 L29.5 28.5 Z"
      fill={GOLD}
    />
    <circle cx="32" cy="32" r="1.6" fill={CREAM} />
  </g>
)

/* Locked state — neutral grey field, simple lock body */
const LOCKED_ILLUSTRATION = (
  <g>
    {/* Padlock body */}
    <rect x="24" y="32" width="16" height="14" rx="2" fill={STONE} />
    {/* Shackle */}
    <path
      d="M27 32 v-4 a5 5 0 0 1 10 0 v4"
      fill="none"
      stroke={STONE}
      strokeWidth="2.4"
      strokeLinecap="round"
    />
    {/* Keyhole */}
    <circle cx="32" cy="38" r="1.6" fill={FOREST_DIM} />
    <rect x="31.4" y="38" width="1.2" height="3" fill={FOREST_DIM} />
  </g>
)

function resolveIllustration(id) {
  let entry = ILLUSTRATIONS[id]
  // Follow alias chain
  while (typeof entry === 'string' && entry.startsWith('alias:')) {
    const aliasId = entry.slice('alias:'.length)
    entry = ILLUSTRATIONS[aliasId]
  }
  return entry || FALLBACK
}

export default function AchievementBadge({
  id,
  size = 'md',
  className = '',
  locked = false,
  title,
}) {
  const px = typeof size === 'number' ? size : (SIZE_PRESETS[size] ?? SIZE_PRESETS.md)
  const ariaLabel = title || (locked ? 'Locked badge' : id || 'Achievement badge')

  const illustration = locked ? LOCKED_ILLUSTRATION : resolveIllustration(id)
  const rimColour = locked ? GOLD_DIM : GOLD
  const fieldColour = locked ? FOREST_DIM : FOREST
  // Locked variant drops the bevel highlight + central illustration glow
  const bevelOpacity = locked ? 0.2 : 0.55

  return (
    <span
      className={`achievement-badge ${locked ? 'locked' : ''} ${className}`}
      role="img"
      aria-label={ariaLabel}
      title={ariaLabel}
      style={{ display: 'inline-flex', width: `${px}px`, height: `${px}px`, flexShrink: 0 }}
    >
      <svg
        viewBox="0 0 64 64"
        width={px}
        height={px}
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        aria-hidden="true"
      >
        {/* 12-point serrated outer rim */}
        <polygon points={RIM_POINTS_64} fill={rimColour} />
        {/* Forest field */}
        <circle cx="32" cy="32" r="23" fill={fieldColour} />
        {/* Subtle gold bevel ring */}
        <circle
          cx="32" cy="32" r="21"
          fill="none"
          stroke={rimColour}
          strokeWidth="0.9"
          opacity={bevelOpacity}
        />
        {/* Foreground illustration */}
        {illustration}
        {/* Tiny centre pip — disabled at small sizes / for locked */}
        {!locked && px >= 36 && (
          <circle cx="32" cy="62" r="0.9" fill={FOREST} opacity="0.4" />
        )}
      </svg>
    </span>
  )
}

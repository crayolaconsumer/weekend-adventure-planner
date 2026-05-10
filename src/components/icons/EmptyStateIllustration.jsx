/**
 * EmptyStateIllustration — branded scene-style SVGs for empty/error states.
 *
 * Replaces decorative emojis (🎭 events empty, 😕 error, 💭 thoughts, etc.)
 * with on-brand illustrations matching the scout-merit-badge aesthetic
 * established by PremiumBadge + CategoryIcon: forest field, gold accents,
 * cream highlights.
 *
 * These are larger than CategoryIcon (~96-120px) and have more storytelling
 * — meant to be calming filler when there's nothing to show.
 */

const FOREST = '#1a3a2f'
const CREAM = '#fdfcf8'
const GOLD = '#d4a855'
const SAGE = '#87a28e'

const ILLUSTRATIONS = {
  /* Quiet town: rooftops + crescent moon — "nothing happening tonight" */
  'events-quiet': (
    <>
      {/* Soft cream sky */}
      <rect x="0" y="0" width="120" height="120" rx="16" fill="#f5f0e6" />
      {/* Distant hills */}
      <path d="M0 78 q30 -18 60 0 q30 18 60 0 v42 H0 z" fill={SAGE} opacity="0.45" />
      {/* Closer hills */}
      <path d="M0 92 q24 -14 50 -2 q26 10 70 -8 v38 H0 z" fill={SAGE} opacity="0.7" />
      {/* Rooftops */}
      <g fill={FOREST}>
        <rect x="22" y="76" width="14" height="22" />
        <path d="M19 76 l10 -8 10 8 z" />
        <rect x="42" y="68" width="18" height="30" />
        <path d="M39 68 l12 -10 12 10 z" />
        <rect x="68" y="80" width="12" height="18" />
        <path d="M65 80 l9 -7 9 7 z" />
        <rect x="86" y="74" width="14" height="24" />
        <path d="M83 74 l10 -8 10 8 z" />
        {/* Tiny window squares */}
        <rect x="48" y="78" width="3" height="3" fill={GOLD} />
        <rect x="55" y="78" width="3" height="3" fill={GOLD} />
        <rect x="27" y="86" width="3" height="3" fill={GOLD} />
        <rect x="91" y="84" width="3" height="3" fill={GOLD} />
      </g>
      {/* Crescent moon */}
      <g transform="translate(95 22)">
        <path d="M0 0 a10 10 0 1 0 0 14 8 8 0 1 1 0 -14 z" fill={GOLD} />
      </g>
      {/* Tiny stars */}
      <circle cx="76" cy="20" r="1.2" fill={GOLD} />
      <circle cx="65" cy="32" r="0.8" fill={GOLD} />
      <circle cx="32" cy="26" r="1" fill={GOLD} />
    </>
  ),

  /* Lost compass: rotated needle off-center — "nothing found" */
  'no-results': (
    <>
      <rect x="0" y="0" width="120" height="120" rx="16" fill="#f5f0e6" />
      {/* Compass face */}
      <circle cx="60" cy="60" r="38" fill={CREAM} stroke={FOREST} strokeWidth="2.5" />
      <circle cx="60" cy="60" r="32" fill="none" stroke={GOLD} strokeWidth="0.8" opacity="0.6" />
      {/* Cardinal pips */}
      <g fill={FOREST}>
        <circle cx="60" cy="28" r="2" />
        <circle cx="92" cy="60" r="1.6" />
        <circle cx="60" cy="92" r="1.6" />
        <circle cx="28" cy="60" r="1.6" />
      </g>
      {/* Spinning needle (rotated 24deg, suggesting confusion) */}
      <g transform="rotate(24 60 60)">
        <polygon points="60,32 64,60 56,60" fill={GOLD} />
        <polygon points="60,88 64,60 56,60" fill={CREAM} stroke={FOREST} strokeWidth="1" />
      </g>
      <circle cx="60" cy="60" r="3.5" fill={FOREST} />
      <circle cx="60" cy="60" r="1.4" fill={GOLD} />
    </>
  ),

  /* Closed map / journal — "nothing here yet" empty state */
  'empty-journal': (
    <>
      <rect x="0" y="0" width="120" height="120" rx="16" fill="#f5f0e6" />
      {/* Journal cover */}
      <rect x="28" y="22" width="64" height="80" rx="4" fill={FOREST} />
      {/* Spine highlight */}
      <rect x="28" y="22" width="6" height="80" fill="#0f2a22" />
      {/* Gold corner detail */}
      <path d="M88 22 h4 v4 q-2 -2 -4 -4 z" fill={GOLD} />
      <path d="M28 98 h4 q-2 2 -4 4 z" fill={GOLD} opacity="0" />
      {/* Compass star centred */}
      <g transform="translate(60 62)">
        <circle r="14" fill="none" stroke={GOLD} strokeWidth="1.2" />
        <path d="M0 -10 L2 0 L10 0 L2 2 L0 10 L-2 2 L-10 0 L-2 0 Z" fill={GOLD} />
        <circle r="1.5" fill={CREAM} />
      </g>
      {/* Bottom title placeholder */}
      <rect x="44" y="84" width="32" height="2" rx="1" fill={GOLD} opacity="0.7" />
    </>
  ),

  /* Fox/owl peeking from behind tree — "we hit a snag" */
  error: (
    <>
      <rect x="0" y="0" width="120" height="120" rx="16" fill="#f5f0e6" />
      {/* Tree trunk */}
      <rect x="68" y="44" width="14" height="60" fill="#5d4731" />
      {/* Tree foliage layers */}
      <circle cx="75" cy="42" r="20" fill={SAGE} />
      <circle cx="75" cy="42" r="20" fill={FOREST} opacity="0.18" />
      {/* Owl peeking */}
      <g transform="translate(40 60)">
        <ellipse cx="14" cy="14" rx="14" ry="16" fill={FOREST} />
        {/* Eyes */}
        <circle cx="9" cy="11" r="3.2" fill={CREAM} />
        <circle cx="19" cy="11" r="3.2" fill={CREAM} />
        <circle cx="9" cy="11" r="1.4" fill={FOREST} />
        <circle cx="19" cy="11" r="1.4" fill={FOREST} />
        {/* Beak */}
        <path d="M14 14 l-2 4 4 0 z" fill={GOLD} />
        {/* Ear tufts */}
        <path d="M2 4 l3 -4 4 5 z" fill={FOREST} />
        <path d="M26 4 l-3 -4 -4 5 z" fill={FOREST} />
      </g>
      {/* Ground */}
      <rect x="0" y="100" width="120" height="20" fill={SAGE} opacity="0.4" />
      {/* Tiny gold accent on the ground */}
      <circle cx="22" cy="106" r="1.4" fill={GOLD} />
      <circle cx="98" cy="108" r="1.2" fill={GOLD} opacity="0.7" />
    </>
  ),

  /* Thinking: speech-bubble cloud with tiny compass star inside */
  thoughts: (
    <>
      <rect x="0" y="0" width="120" height="120" rx="16" fill="#f5f0e6" />
      {/* Cloud bubble */}
      <g fill={FOREST}>
        <ellipse cx="46" cy="50" rx="22" ry="16" />
        <ellipse cx="74" cy="46" rx="20" ry="18" />
        <ellipse cx="62" cy="62" rx="28" ry="14" />
      </g>
      {/* Trailing thought dots */}
      <circle cx="42" cy="80" r="4" fill={FOREST} />
      <circle cx="34" cy="92" r="2.6" fill={FOREST} />
      <circle cx="29" cy="100" r="1.4" fill={FOREST} />
      {/* Tiny compass star inside the cloud */}
      <g transform="translate(60 54)">
        <path d="M0 -8 L2 0 L8 0 L2 2 L0 8 L-2 2 L-8 0 L-2 0 Z" fill={GOLD} />
      </g>
    </>
  ),

  /* Confetti badge — for success states (replaces 🎉) */
  celebration: (
    <>
      <rect x="0" y="0" width="120" height="120" rx="16" fill="#f5f0e6" />
      {/* Big medallion centre */}
      <circle cx="60" cy="62" r="28" fill={FOREST} />
      <circle cx="60" cy="62" r="28" fill="none" stroke={GOLD} strokeWidth="2" />
      <circle cx="60" cy="62" r="22" fill="none" stroke={CREAM} strokeWidth="0.8" opacity="0.4" />
      {/* Compass star */}
      <g transform="translate(60 62)">
        <path d="M0 -16 L3 -2 L16 0 L3 2 L0 16 L-3 2 L-16 0 L-3 -2 Z" fill={GOLD} />
        <circle r="2" fill={FOREST} />
      </g>
      {/* Confetti scattered */}
      <g>
        <rect x="14" y="22" width="6" height="3" rx="1" fill={GOLD} transform="rotate(-20 17 23)" />
        <rect x="98" y="18" width="6" height="3" rx="1" fill="#c45c3e" transform="rotate(35 101 19)" />
        <rect x="20" y="92" width="5" height="3" rx="1" fill={SAGE} transform="rotate(15 23 93)" />
        <rect x="96" y="94" width="6" height="3" rx="1" fill={GOLD} transform="rotate(-25 99 95)" />
        <circle cx="100" cy="50" r="2" fill={GOLD} />
        <circle cx="14" cy="56" r="1.6" fill="#c45c3e" />
        <circle cx="30" cy="14" r="1.4" fill={SAGE} />
        <circle cx="92" cy="80" r="1.8" fill={GOLD} />
      </g>
    </>
  ),
}

const SIZE_PRESETS = {
  sm: 80,
  md: 120,
  lg: 160,
  hero: 200,
}

export default function EmptyStateIllustration({
  variant,
  size = 'md',
  className = '',
  title,
}) {
  const px = typeof size === 'number' ? size : (SIZE_PRESETS[size] ?? SIZE_PRESETS.md)
  const illustration = ILLUSTRATIONS[variant] || ILLUSTRATIONS.thoughts

  return (
    <span
      className={`empty-state-illustration ${className}`}
      role="img"
      aria-label={title || variant || 'illustration'}
      style={{ display: 'inline-flex', width: `${px}px`, height: `${px}px` }}
    >
      <svg
        viewBox="0 0 120 120"
        width={px}
        height={px}
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        aria-hidden="true"
      >
        {illustration}
      </svg>
    </span>
  )
}

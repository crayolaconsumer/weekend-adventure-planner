/**
 * PremiumBadge
 *
 * Scout-merit-badge styled SVG marker shown next to ROAM+ subscribers.
 *
 * Anatomy (matches ROAM's earth palette):
 *   - 12-point serrated outer (gold, #d4a855) — the "earned" merit feel
 *   - Forest green inner field (#1a3a2f) with a subtle gold bevel ring
 *   - Central compass-rose star (gold) — references the brand 🧭 favicon
 *     and reinforces ROAM's exploration identity
 *
 * Renders at any size; scales the SVG up cleanly. Tiny sizes (≤12px)
 * lose detail in the compass star but the silhouette still reads as
 * "premium ring + center mark".
 *
 * Place absolutely-positioned over the bottom-right of an avatar via
 * the .avatar-wrapper-with-badge layout helper, or inline next to a
 * username with size="inline".
 */

import './PremiumBadge.css'

const SIZE_PRESETS = {
  xs: 12,
  sm: 14,
  inline: 14,
  md: 18,
  lg: 24,
  hero: 56
}

export default function PremiumBadge({
  size = 'sm',
  className = '',
  title = 'ROAM+ subscriber',
  showBevel = true
}) {
  const px = typeof size === 'number' ? size : (SIZE_PRESETS[size] ?? SIZE_PRESETS.sm)
  // For very small sizes, drop the bevel highlight (it disappears anyway)
  const renderBevel = showBevel && px >= 14

  return (
    <span
      className={`premium-badge ${className}`}
      role="img"
      aria-label={title}
      title={title}
      style={{ width: `${px}px`, height: `${px}px` }}
    >
      <svg
        viewBox="0 0 32 32"
        width={px}
        height={px}
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        aria-hidden="true"
      >
        {/* 12-point serrated outer rim — gold */}
        <polygon
          points="16,0.4 22.4,4.6 28,2.8 30,9.2 31.6,16 30,22.8 28,29.2 22.4,27.4 16,31.6 9.6,27.4 4,29.2 2,22.8 0.4,16 2,9.2 4,2.8 9.6,4.6"
          fill="#d4a855"
        />
        {/* Inner forest field */}
        <circle cx="16" cy="16" r="11.5" fill="#1a3a2f" />
        {/* Subtle gold bevel ring inside the forest field (omitted at very small sizes) */}
        {renderBevel && (
          <circle
            cx="16"
            cy="16"
            r="10.5"
            fill="none"
            stroke="#d4a855"
            strokeWidth="0.6"
            opacity="0.55"
          />
        )}
        {/* Central compass-rose star — gold */}
        <path
          d="M16 7 L17.6 14.4 L24 16 L17.6 17.6 L16 25 L14.4 17.6 L8 16 L14.4 14.4 Z"
          fill="#d4a855"
        />
        {/* Tiny center pip in dark to give the compass focal weight */}
        <circle cx="16" cy="16" r="0.9" fill="#1a3a2f" />
      </svg>
    </span>
  )
}

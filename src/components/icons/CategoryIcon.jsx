/**
 * CategoryIcon — branded medallion-style SVG for ROAM place categories.
 *
 * Visual language matches PremiumBadge's scout-merit-badge identity:
 *   - Circular medallion at 32x32 viewBox
 *   - Inner field in the category's signature color (from categories.js)
 *   - Forest-green outer ring (#1a3a2f, 1.5px)
 *   - Cream silhouette illustration (#fdfcf8) for high contrast
 *   - Tiny gold accent (#d4a855) at NE corner — collected-stamp feel
 *
 * Replaces the emoji icons (🍽️, 🌿, etc.) that used to live in
 * categories.js with proper brand-consistent illustrations.
 *
 * Usage:
 *   <CategoryIcon name="food" size={32} />
 *   <CategoryIcon name={place.category?.key} size="md" />
 *
 * Falls back to a generic compass-pin medallion for unknown categories.
 */

const SIZE_PRESETS = {
  xs: 14,
  sm: 18,
  md: 24,
  lg: 32,
  xl: 48,
  hero: 80
}

const CATEGORY_FIELD = {
  food: '#c45c3e',          // terracotta
  nature: '#87a28e',        // sage
  culture: '#6b5b95',       // dusty plum
  historic: '#8b7355',      // weathered umber
  entertainment: '#e07a5f', // warm coral
  nightlife: '#4a4a8a',     // midnight indigo
  active: '#2d9cdb',        // wave blue
  unique: '#d4a855',        // gold (special — uses cream field instead, see render)
  shopping: '#9b59b6',      // muted violet
}

const FOREST = '#1a3a2f'
const CREAM = '#fdfcf8'
const GOLD = '#d4a855'

/**
 * Each category exports a paths fragment — the cream-coloured silhouette
 * inside the medallion. Designed at viewBox 0 0 32 32, centred at (16,16),
 * occupying roughly the inner ~16x16 area to leave breathing room for the rim.
 */
const ILLUSTRATIONS = {
  food: (
    /* Crossed fork + knife: bold silhouette, reads at small sizes */
    <g fill={CREAM}>
      {/* Fork — tines + handle */}
      <path d="M11.4 8.5 v4.5 a1.6 1.6 0 0 0 1.2 1.55 v9 a0.9 0.9 0 0 0 1.8 0 v-9 a1.6 1.6 0 0 0 1.2 -1.55 v-4.5 h-0.9 v3.7 h-0.7 v-3.7 h-0.9 v3.7 h-0.7 v-3.7 z" />
      {/* Knife — blade + handle */}
      <path d="M20 8.5 c-1.4 0 -2.4 1.6 -2.4 4 v3 a1 1 0 0 0 1 1 h0.5 v7 a0.95 0.95 0 0 0 1.9 0 v-15 z" />
    </g>
  ),
  nature: (
    /* Leaf with centre vein — organic, asymmetric for natural feel */
    <g>
      <path
        fill={CREAM}
        d="M22.5 8.5 c-7 0 -12.5 4.2 -12.5 10.5 0 1.6 0.4 3 1 4.3 0.4 -3.4 2.4 -6.4 5.4 -8.4 -2.2 2.4 -3.6 5.6 -3.8 9.1 1.5 1 3.4 1.5 5.4 1.5 6 0 9.5 -5.4 9.5 -10.5 0 -2.4 -0.7 -4.6 -2 -6.5 -1 0.1 -2 0.1 -3 0 z"
      />
      {/* Centre vein */}
      <path
        fill={FOREST}
        opacity="0.35"
        d="M21 11 c-3 1.5 -5.5 3.8 -7 6.8 -0.6 1.2 -1 2.5 -1.2 3.8 0.4 0.1 0.7 0.1 1 0.2 0.3 -1.2 0.7 -2.4 1.3 -3.5 1.5 -3 4 -5.3 7 -6.6 z"
      />
    </g>
  ),
  culture: (
    /* Theatre proscenium: curtain swag + arch — culture as performance */
    <g fill={CREAM}>
      {/* Stage arch */}
      <path d="M9 23 v-9 a7 7 0 0 1 14 0 v9 h-1.6 v-9 a5.4 5.4 0 0 0 -10.8 0 v9 z" />
      {/* Curtain swag */}
      <path d="M9 9.5 h14 v2.5 c-2 1.2 -4.5 1.8 -7 1.8 -2.5 0 -5 -0.6 -7 -1.8 z" />
      {/* Tassel */}
      <circle cx="16" cy="14.6" r="0.8" />
    </g>
  ),
  historic: (
    /* Castle keep with crenellations + flag */
    <g>
      <path
        fill={CREAM}
        d="M9 23.5 v-10 h2.4 v-2.2 h2 v2.2 h2 v-2.2 h2 v2.2 h2 v-2.2 h2 v2.2 h1.6 v10 z"
      />
      {/* Door */}
      <path fill={FOREST} d="M14.6 23.5 v-3.6 a1.4 1.4 0 0 1 2.8 0 v3.6 z" />
      {/* Flag pole + flag */}
      <rect x="15.7" y="6.5" width="0.6" height="5" fill={CREAM} />
      <path d="M16.3 6.5 l4 1.2 -4 1.2 z" fill={GOLD} />
    </g>
  ),
  entertainment: (
    /* Circus tent: triangular peak with vertical stripes + pennant */
    <g>
      <path
        fill={CREAM}
        d="M16 7.5 l-7.5 7.5 v8.5 h15 v-8.5 z"
      />
      {/* Vertical stripe — half tone for stripe effect */}
      <path
        fill={FOREST}
        opacity="0.18"
        d="M14 14.5 l2 -2 0 11 -2 0 z M18 14.5 l-2 -2 0 11 2 0 z"
      />
      {/* Door arch */}
      <path fill={FOREST} d="M14.6 23.5 v-3.6 a1.4 1.4 0 0 1 2.8 0 v3.6 z" />
      {/* Pennant on top */}
      <path d="M16 7.5 l3.5 1 -3.5 1 z" fill={GOLD} />
    </g>
  ),
  nightlife: (
    /* Crescent moon + tiny star — moonlight pictogram */
    <g>
      <path
        fill={CREAM}
        d="M21 11.5 a7 7 0 1 0 0 9 5 5 0 1 1 0 -9 z"
      />
      <path d="M11 10.5 l0.4 1.2 1.2 0.4 -1.2 0.4 -0.4 1.2 -0.4 -1.2 -1.2 -0.4 1.2 -0.4 z" fill={GOLD} />
    </g>
  ),
  active: (
    /* Lightning bolt — energy, motion */
    <path
      fill={CREAM}
      d="M18.5 7 l-7 11 h4 l-1.5 7 7 -11 h-4 z"
    />
  ),
  unique: (
    /* Faceted gem — diamond with facet lines */
    <g>
      <path
        fill={CREAM}
        d="M10 13 l2.5 -4.5 h7 l2.5 4.5 -6 11 z"
      />
      {/* Facet lines for depth */}
      <path
        fill={FOREST}
        opacity="0.25"
        d="M12.5 8.5 l3.5 4.5 -6 0 z M19.5 8.5 l-3.5 4.5 6 0 z"
      />
      <path
        fill={FOREST}
        opacity="0.18"
        d="M10 13 l6 11 0 -11 z"
      />
    </g>
  ),
  shopping: (
    /* Market tote with handles */
    <g>
      <path
        fill={CREAM}
        d="M10.5 13 h11 l-1 11 h-9 z"
      />
      {/* Handle loops */}
      <path
        d="M13 13 v-1.5 a3 3 0 0 1 6 0 v1.5"
        fill="none"
        stroke={CREAM}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      {/* Tiny gold knot accent */}
      <circle cx="16" cy="18" r="0.9" fill={GOLD} />
    </g>
  ),
}

/* Generic fallback — compass-pin medallion for unknown categories */
const FALLBACK = (
  <g>
    <circle cx="16" cy="16" r="3.5" fill={CREAM} />
    <circle cx="16" cy="16" r="1.4" fill={GOLD} />
  </g>
)

export default function CategoryIcon({
  name,
  size = 'md',
  className = '',
  title
}) {
  const px = typeof size === 'number' ? size : (SIZE_PRESETS[size] ?? SIZE_PRESETS.md)
  const field = name === 'unique' ? CREAM : (CATEGORY_FIELD[name] || FOREST)
  const illustration = ILLUSTRATIONS[name] || FALLBACK
  const ariaLabel = title || name || 'place category'

  // For 'unique' we flip the palette — cream field, forest illustration —
  // because gold-on-gold loses contrast. Easier than redesigning every gem path.
  const isUnique = name === 'unique'
  const flippedIllustration = isUnique ? (
    <g>
      <path
        fill={FOREST}
        d="M10 13 l2.5 -4.5 h7 l2.5 4.5 -6 11 z"
      />
      <path
        fill={GOLD}
        opacity="0.5"
        d="M12.5 8.5 l3.5 4.5 -6 0 z M19.5 8.5 l-3.5 4.5 6 0 z"
      />
    </g>
  ) : illustration

  return (
    <span
      className={`category-icon ${className}`}
      role="img"
      aria-label={ariaLabel}
      title={ariaLabel}
      style={{ display: 'inline-flex', width: `${px}px`, height: `${px}px`, flexShrink: 0 }}
    >
      <svg
        viewBox="0 0 32 32"
        width={px}
        height={px}
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        aria-hidden="true"
      >
        {/* Inner field — category color */}
        <circle cx="16" cy="16" r="14.5" fill={field} />
        {/* Forest-green outer ring (subtle frame) */}
        <circle cx="16" cy="16" r="14.5" fill="none" stroke={FOREST} strokeWidth="1.2" />
        {/* Inner highlight ring (depth, like PremiumBadge's bevel) */}
        {px >= 18 && (
          <circle cx="16" cy="16" r="13" fill="none" stroke={CREAM} strokeWidth="0.5" opacity="0.25" />
        )}
        {/* Foreground illustration */}
        {flippedIllustration}
        {/* Tiny gold accent dot at NE — unifying mark across the set */}
        {px >= 20 && !isUnique && (
          <circle cx="25" cy="7" r="1.3" fill={GOLD} stroke={FOREST} strokeWidth="0.4" />
        )}
      </svg>
    </span>
  )
}

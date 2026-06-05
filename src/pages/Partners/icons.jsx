/**
 * Brand SVG icons for the partner portal — no emoji.
 * Stroke icons inherit currentColor (set colour via CSS); the compass mark is
 * the ROAM brand favicon, inlined (same as the consumer Onboarding hero).
 */

export const CompassMark = ({ size = 88 }) => (
  <svg width={size} height={size} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="256" cy="256" r="256" fill="#1a3a2f" />
    <g transform="translate(256, 256)">
      <circle cx="0" cy="0" r="180" fill="none" stroke="#d4a855" strokeWidth="8" />
      <polygon points="0,-160 20,-40 -20,-40" fill="#d4a855" />
      <polygon points="0,160 20,40 -20,40" fill="#fdfcf8" />
      <polygon points="160,0 40,20 40,-20" fill="#fdfcf8" />
      <polygon points="-160,0 -40,20 -40,-20" fill="#fdfcf8" />
      <circle cx="0" cy="0" r="30" fill="#d4a855" />
      <circle cx="0" cy="0" r="15" fill="#1a3a2f" />
    </g>
  </svg>
)

/**
 * Reach icon — a location pin radiating concentric rings. `level` 1–4 maps to
 * Local / Town / City / Region (more rings = wider reach).
 */
export const ReachIcon = ({ level = 1, size = 30 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <circle cx="16" cy="16" r="2.5" fill="currentColor" stroke="none" />
    {level >= 1 && <circle cx="16" cy="16" r="6" opacity="0.95" />}
    {level >= 2 && <circle cx="16" cy="16" r="9.5" opacity="0.7" />}
    {level >= 3 && <circle cx="16" cy="16" r="13" opacity="0.5" />}
    {level >= 4 && <circle cx="16" cy="16" r="15" opacity="0.4" strokeDasharray="2 3" />}
  </svg>
)

export const SparkIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <path d="M12 8.5l1.4 2.1L15.5 12l-2.1 1.4L12 15.5l-1.4-2.1L8.5 12l2.1-1.4z" fill="currentColor" stroke="none" />
  </svg>
)

export const StarIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2.5l2.7 5.9 6.3.6-4.7 4.2 1.4 6.3L12 16.9 6.3 19.5l1.4-6.3L3 9l6.3-.6z" />
  </svg>
)

export const MegaphoneIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 11v2a1 1 0 0 0 1 1h2l9 4V6L6 10H4a1 1 0 0 0-1 1z" />
    <path d="M18 8a4 4 0 0 1 0 8" />
  </svg>
)

export const CheckIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

export const ArrowLeftIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
)

export const PlusIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

export const EyeIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" />
  </svg>
)

export const PinIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
)

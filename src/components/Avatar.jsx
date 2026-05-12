import { useState } from 'react'

/**
 * Avatar — user image with graceful initials fallback.
 *
 * Was rendering raw <img src={user.avatar_url || '/default-avatar.png'} />
 * everywhere — /default-avatar.png doesn't exist in /public, so users
 * without an uploaded photo saw the iOS broken-image icon. This component
 * falls back to a brand-coloured circle with the user's initials.
 *
 * Used in SocialHub header, visited-map landing, and visited-map page.
 *
 * Props:
 *   - user: { avatar_url?, avatarUrl?, display_name?, displayName?, username?, name? }
 *   - size: pixel size (default 40)
 *   - className: forwarded to the wrapper
 *   - alt: forwarded to img (default '')
 */
function getInitials(user) {
  if (!user) return '?'
  const name = user.displayName || user.display_name || user.name || user.username || ''
  if (!name) return '?'
  const parts = String(name).trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Pick a stable hue based on initials so two users with no avatar
// don't blend into one another. Brand-friendly: rotates only across
// the warm half (40°–60° hue stays in the gold/terracotta family).
function getHue(initials) {
  let h = 0
  for (const c of initials) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return 30 + (h % 70) // 30..99°
}

export default function Avatar({ user, size = 40, className = '', alt = '' }) {
  const [errored, setErrored] = useState(false)
  const url = user?.avatar_url || user?.avatarUrl
  const initials = getInitials(user)
  const hue = getHue(initials)

  if (!url || errored) {
    return (
      <span
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          borderRadius: '50%',
          background: `linear-gradient(135deg, hsl(${hue}, 35%, 52%), hsl(${hue}, 38%, 38%))`,
          color: 'var(--roam-cream, #faf8f5)',
          fontFamily: 'var(--font-display, serif)',
          fontWeight: 600,
          fontSize: Math.round(size * 0.42),
          lineHeight: 1,
          letterSpacing: '0.02em',
          flexShrink: 0,
          userSelect: 'none',
        }}
        aria-label={alt || `${initials} avatar`}
      >
        {initials}
      </span>
    )
  }

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      onError={() => setErrored(true)}
    />
  )
}

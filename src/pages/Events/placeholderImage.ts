/**
 * Deterministic placeholder image picker for events without a hero image.
 *
 * Why deterministic: scrolling through the swipe deck must not reshuffle
 * the picture for an event when React rerenders. We hash the event id
 * into the bucket index so the same event always lands on the same image.
 */

export const EVENT_IMAGES: Record<string, string[]> = {
  music: [
    'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&q=80',
    'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=800&q=80',
    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&q=80',
  ],
  entertainment: [
    'https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?w=800&q=80',
    'https://images.unsplash.com/photo-1585699324551-f6c309eedeca?w=800&q=80',
  ],
  culture: [
    'https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=800&q=80',
    'https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=800&q=80',
  ],
  nightlife: [
    'https://images.unsplash.com/photo-1566417713940-fe7c737a9ef2?w=800&q=80',
    'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=800&q=80',
  ],
  default: [
    'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80',
    'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=800&q=80',
  ],
}

/**
 * Pick a placeholder image based on the event's first category, indexed
 * by a hash of the event id so the choice is stable across renders.
 */
export function getEventPlaceholderImage(
  eventId: string | number | null | undefined,
  categories: string[] | null | undefined,
): string {
  const category = categories?.[0] || 'default'
  const images = EVENT_IMAGES[category] || EVENT_IMAGES.default
  const idStr = eventId?.toString() || ''
  const hash = idStr.split('').reduce((a, b) => a + b.charCodeAt(0), 0)
  const index = Math.abs(hash) % images.length
  return images[index]
}

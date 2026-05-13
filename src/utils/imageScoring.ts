/**
 * Image Quality Scoring System
 *
 * Scores images from different sources to select the best one for display.
 * Higher scores indicate better quality images.
 */

export type ImageSource =
  | 'wikipedia'
  | 'wikidata'
  | 'opentripmap'
  | 'unsplash'
  | 'user'
  | 'placeholder'
  | string

export interface ImageData {
  url: string
  source?: ImageSource
  width?: number | null
  height?: number | null
  [key: string]: unknown
}

export interface ScoredImage extends ImageData {
  qualityScore: number
  scoredAt?: number
}

// Source reliability scores (0-100 base)
const SOURCE_SCORES: Record<string, number> = {
  wikipedia: 80,
  wikidata: 75,
  opentripmap: 60,
  unsplash: 50,
  user: 90, // User uploads are highly relevant
  placeholder: 20,
}

/**
 * Score an image based on various quality signals.
 */
export function scoreImage(imageData: Partial<ImageData> | null | undefined): ScoredImage {
  if (!imageData?.url) {
    return { ...(imageData ?? {}), url: imageData?.url ?? '', qualityScore: 0 } as ScoredImage
  }

  let score = (imageData.source && SOURCE_SCORES[imageData.source]) || 40

  // Resolution bonus
  if (imageData.width) {
    if (imageData.width >= 1200) score += 10
    else if (imageData.width >= 800) score += 5
    else if (imageData.width < 400) score -= 10
  }

  // Aspect ratio check (prefer landscape/square for cards)
  if (imageData.width && imageData.height) {
    const aspectRatio = imageData.width / imageData.height

    if (aspectRatio >= 1.0 && aspectRatio <= 2.0) {
      score += 5
    } else if (aspectRatio < 0.5 || aspectRatio > 2.5) {
      score -= 15
    }
  }

  // URL quality signals
  const url = imageData.url.toLowerCase()

  if (url.includes('1280') || url.includes('1200') || url.includes('large')) {
    score += 5
  }
  if (url.includes('thumb') || url.includes('small') || url.includes('_s.')) {
    score -= 10
  }

  if (url.startsWith('https://')) {
    score += 2
  }

  const qualityScore = Math.max(0, Math.min(100, score))

  return {
    ...imageData,
    url: imageData.url,
    qualityScore,
    scoredAt: Date.now(),
  } as ScoredImage
}

/**
 * Select the best image from a list of candidates.
 */
export function selectBestImage(candidates: Partial<ImageData>[] | null | undefined): ScoredImage | null {
  if (!candidates || candidates.length === 0) return null

  const scored = candidates
    .filter((c): c is ImageData => Boolean(c?.url))
    .map(scoreImage)
    .sort((a, b) => b.qualityScore - a.qualityScore)

  return scored[0] || null
}

/**
 * Create image metadata object.
 */
export function createImageMeta(
  url: string,
  source: ImageSource,
  extras: Partial<ImageData> = {},
): ImageData {
  return {
    url,
    source,
    width: extras.width ?? null,
    height: extras.height ?? null,
    ...extras,
  }
}

/**
 * Validate if a URL is likely a valid image.
 */
export function isValidImageUrl(url: unknown): boolean {
  if (!url || typeof url !== 'string') return false

  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return false

    const pathname = parsed.pathname.toLowerCase()
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']
    const imageHosts = ['upload.wikimedia.org', 'images.unsplash.com', 'source.unsplash.com']

    const hasImageExtension = imageExtensions.some(ext => pathname.endsWith(ext))
    const isImageHost = imageHosts.some(host => parsed.hostname.includes(host))

    return hasImageExtension || isImageHost || pathname.includes('/image') || pathname.includes('/photo')
  } catch {
    return false
  }
}

/**
 * Preload an image and get its dimensions.
 */
export function preloadImage(
  url: string,
  timeout: number = 5000,
): Promise<{ width: number | null; height: number | null; loaded: boolean }> {
  return new Promise((resolve) => {
    const img = new Image()
    const timeoutId = setTimeout(() => {
      img.src = ''
      resolve({ width: null, height: null, loaded: false })
    }, timeout)

    img.onload = () => {
      clearTimeout(timeoutId)
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
        loaded: true,
      })
    }

    img.onerror = () => {
      clearTimeout(timeoutId)
      resolve({ width: null, height: null, loaded: false })
    }

    img.src = url
  })
}

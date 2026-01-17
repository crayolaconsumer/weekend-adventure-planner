/**
 * Image Quality Scoring System
 *
 * Scores images from different sources to select the best one for display.
 * Higher scores indicate better quality images.
 */

// Source reliability scores (0-100 base)
const SOURCE_SCORES = {
  wikipedia: 80,
  wikidata: 75,
  opentripmap: 60,
  unsplash: 50,
  user: 90, // User uploads are highly relevant
  placeholder: 20
}

/**
 * Score an image based on various quality signals
 * @param {Object} imageData - Image metadata
 * @param {string} imageData.url - Image URL
 * @param {string} imageData.source - Source identifier
 * @param {number} [imageData.width] - Image width in pixels
 * @param {number} [imageData.height] - Image height in pixels
 * @returns {Object} Image data with quality score
 */
export function scoreImage(imageData) {
  if (!imageData?.url) {
    return { ...imageData, qualityScore: 0 }
  }

  let score = SOURCE_SCORES[imageData.source] || 40

  // Resolution bonus
  if (imageData.width) {
    if (imageData.width >= 1200) score += 10
    else if (imageData.width >= 800) score += 5
    else if (imageData.width < 400) score -= 10
  }

  // Aspect ratio check (prefer landscape/square for cards)
  if (imageData.width && imageData.height) {
    const aspectRatio = imageData.width / imageData.height

    // Ideal for cards: 4:3 to 16:9 (1.33 to 1.78)
    if (aspectRatio >= 1.0 && aspectRatio <= 2.0) {
      score += 5
    } else if (aspectRatio < 0.5 || aspectRatio > 2.5) {
      // Too narrow or too wide
      score -= 15
    }
  }

  // URL quality signals
  const url = imageData.url.toLowerCase()

  // Prefer larger image URLs (common patterns)
  if (url.includes('1280') || url.includes('1200') || url.includes('large')) {
    score += 5
  }
  if (url.includes('thumb') || url.includes('small') || url.includes('_s.')) {
    score -= 10
  }

  // HTTPS bonus
  if (url.startsWith('https://')) {
    score += 2
  }

  // Clamp to 0-100
  const qualityScore = Math.max(0, Math.min(100, score))

  return {
    ...imageData,
    qualityScore,
    scoredAt: Date.now()
  }
}

/**
 * Select the best image from a list of candidates
 * @param {Array} candidates - Array of image data objects
 * @returns {Object|null} Best scoring image or null
 */
export function selectBestImage(candidates) {
  if (!candidates || candidates.length === 0) return null

  const scored = candidates
    .filter(c => c?.url)
    .map(scoreImage)
    .sort((a, b) => b.qualityScore - a.qualityScore)

  return scored[0] || null
}

/**
 * Create image metadata object
 * @param {string} url - Image URL
 * @param {string} source - Source identifier
 * @param {Object} [extras] - Additional metadata
 * @returns {Object} Image metadata
 */
export function createImageMeta(url, source, extras = {}) {
  return {
    url,
    source,
    width: extras.width || null,
    height: extras.height || null,
    ...extras
  }
}

/**
 * Validate if a URL is likely a valid image
 * @param {string} url - URL to validate
 * @returns {boolean}
 */
export function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false

  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return false

    // Check for common image extensions or known image hosts
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
 * Preload an image and get its dimensions
 * @param {string} url - Image URL
 * @param {number} [timeout=5000] - Timeout in ms
 * @returns {Promise<{width: number, height: number, loaded: boolean}>}
 */
export function preloadImage(url, timeout = 5000) {
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
        loaded: true
      })
    }

    img.onerror = () => {
      clearTimeout(timeoutId)
      resolve({ width: null, height: null, loaded: false })
    }

    img.src = url
  })
}

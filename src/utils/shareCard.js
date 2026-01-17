/**
 * Share Card Generator
 *
 * Generates shareable images using Canvas API for places and adventures.
 */

/**
 * Generate a shareable place card image
 * @param {Object} place - Place object
 * @param {Object} options - Generation options
 * @returns {Promise<Blob>} - Image blob
 */
export async function generatePlaceCard(place, options = {}) {
  const {
    width = 1080,
    height = 1350, // Instagram portrait ratio
    backgroundColor = '#1a3a2f',
    accentColor = '#d4a855'
  } = options

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  // Background
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, width, height)

  // Load and draw place image if available
  const imageUrl = place.photo || place.image
  if (imageUrl) {
    try {
      const img = await loadImage(imageUrl)
      // Draw image covering top 60% with gradient fade
      const imageHeight = height * 0.6
      ctx.drawImage(img, 0, 0, width, imageHeight)

      // Gradient overlay
      const gradient = ctx.createLinearGradient(0, imageHeight * 0.4, 0, imageHeight)
      gradient.addColorStop(0, 'rgba(26, 58, 47, 0)')
      gradient.addColorStop(1, 'rgba(26, 58, 47, 1)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, imageHeight)
    } catch (e) {
      // Image failed to load, continue with solid background
      console.debug('Failed to load image for share card:', e)
    }
  }

  // Content area
  const contentY = height * 0.55
  const padding = 60

  // Category badge
  if (place.category) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
    const badgeText = `${place.category.icon} ${place.category.label}`
    ctx.font = 'bold 28px system-ui, sans-serif'
    const badgeMetrics = ctx.measureText(badgeText)
    const badgeWidth = badgeMetrics.width + 40
    const badgeHeight = 50

    roundRect(ctx, padding, contentY, badgeWidth, badgeHeight, 25)
    ctx.fill()

    ctx.fillStyle = 'white'
    ctx.fillText(badgeText, padding + 20, contentY + 35)
  }

  // Place name
  ctx.fillStyle = 'white'
  ctx.font = 'bold 64px Georgia, serif'
  const nameY = contentY + 120
  wrapText(ctx, place.name, padding, nameY, width - padding * 2, 75)

  // Description if available
  if (place.description) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
    ctx.font = 'italic 32px Georgia, serif'
    const descY = nameY + 160
    wrapText(ctx, `"${place.description}"`, padding, descY, width - padding * 2, 42, 3)
  }

  // ROAM branding at bottom
  const brandingY = height - 100
  ctx.fillStyle = accentColor
  ctx.font = 'bold 36px system-ui, sans-serif'
  ctx.fillText('ROAM', padding, brandingY)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
  ctx.font = '24px system-ui, sans-serif'
  ctx.fillText('Discover local adventures', padding, brandingY + 40)

  // Convert to blob
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/png', 0.9)
  })
}

/**
 * Generate adventure summary card
 * @param {Object[]} places - Array of visited places
 * @param {Object} stats - Adventure stats
 * @returns {Promise<Blob>}
 */
export async function generateAdventureCard(places, stats = {}) {
  const width = 1080
  const height = 1920 // Instagram story ratio

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  // Background gradient
  const bgGradient = ctx.createLinearGradient(0, 0, 0, height)
  bgGradient.addColorStop(0, '#1a3a2f')
  bgGradient.addColorStop(1, '#0f2318')
  ctx.fillStyle = bgGradient
  ctx.fillRect(0, 0, width, height)

  // Decorative elements
  ctx.fillStyle = 'rgba(212, 168, 85, 0.1)'
  ctx.beginPath()
  ctx.arc(width * 0.8, height * 0.15, 200, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(width * 0.2, height * 0.85, 150, 0, Math.PI * 2)
  ctx.fill()

  const padding = 60

  // Header
  ctx.fillStyle = '#d4a855'
  ctx.font = 'bold 48px system-ui, sans-serif'
  ctx.fillText('ROAM', padding, 100)

  ctx.fillStyle = 'white'
  ctx.font = 'bold 72px Georgia, serif'
  ctx.fillText("Today's Adventure", padding, 200)

  // Stats
  const statsY = 300
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.font = '32px system-ui, sans-serif'

  const statItems = [
    { icon: '📍', value: `${places.length} places` },
    { icon: '🚶', value: stats.distance ? `${stats.distance.toFixed(1)}km explored` : '' },
    { icon: '⭐', value: stats.favorites ? `${stats.favorites} favorites` : '' }
  ].filter(s => s.value)

  statItems.forEach((stat, i) => {
    ctx.fillText(`${stat.icon} ${stat.value}`, padding + (i * 280), statsY)
  })

  // Places list
  let placeY = 420
  const maxPlaces = Math.min(places.length, 6)

  for (let i = 0; i < maxPlaces; i++) {
    const place = places[i]

    // Place card background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
    roundRect(ctx, padding, placeY, width - padding * 2, 180, 20)
    ctx.fill()

    // Category icon
    if (place.category?.icon) {
      ctx.font = '48px system-ui'
      ctx.fillText(place.category.icon, padding + 30, placeY + 70)
    }

    // Place name
    ctx.fillStyle = 'white'
    ctx.font = 'bold 36px Georgia, serif'
    ctx.fillText(truncateText(place.name, 30), padding + 100, placeY + 60)

    // Place type
    if (place.type) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
      ctx.font = '24px system-ui, sans-serif'
      ctx.fillText(place.type.replace(/_/g, ' '), padding + 100, placeY + 100)
    }

    // Recommendation badge
    if (place.recommended) {
      ctx.fillStyle = '#22c55e'
      ctx.font = '28px system-ui'
      ctx.fillText('💚', width - padding - 60, placeY + 70)
    }

    placeY += 200
  }

  if (places.length > maxPlaces) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.font = '28px system-ui, sans-serif'
    ctx.fillText(`+ ${places.length - maxPlaces} more places`, padding, placeY + 40)
  }

  // Footer branding
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
  ctx.font = '24px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Made with ROAM • go-roam.uk', width / 2, height - 60)
  ctx.textAlign = 'left'

  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/png', 0.9)
  })
}

/**
 * Share content using Web Share API or fallback
 * @param {Object} shareData - Share data
 * @returns {Promise<boolean>} - Whether share was successful
 */
export async function shareContent(shareData) {
  const { title, text, url, files } = shareData

  // Try native share API first
  if (navigator.share) {
    try {
      const data = { title, text, url }

      // Add files if supported and provided
      if (files?.length && navigator.canShare?.({ files })) {
        data.files = files
      }

      await navigator.share(data)
      return true
    } catch (err) {
      if (err.name === 'AbortError') {
        // User cancelled - not an error
        return false
      }
      console.debug('Native share failed:', err)
    }
  }

  // Fallback: copy to clipboard
  try {
    const shareText = `${title}\n\n${text}\n\n${url}`
    await navigator.clipboard.writeText(shareText)
    return true
  } catch (err) {
    console.error('Clipboard copy failed:', err)
    return false
  }
}

/**
 * Download blob as file
 * @param {Blob} blob - File blob
 * @param {string} filename - Filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Helper functions

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  ctx.lineTo(x + radius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 4) {
  const words = text.split(' ')
  let line = ''
  let lineCount = 0

  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i] + ' '
    const metrics = ctx.measureText(testLine)

    if (metrics.width > maxWidth && i > 0) {
      ctx.fillText(line.trim(), x, y)
      line = words[i] + ' '
      y += lineHeight
      lineCount++

      if (lineCount >= maxLines - 1) {
        // Last line - add ellipsis if more words
        const remaining = words.slice(i).join(' ')
        if (remaining.length > 0) {
          ctx.fillText(truncateText(remaining, 40) + '...', x, y)
        }
        return
      }
    } else {
      line = testLine
    }
  }
  ctx.fillText(line.trim(), x, y)
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 1) + '…'
}

/**
 * Compress and resize an image File before upload.
 *
 * Phone photos (Pixel, iPhone) routinely exceed our 5MB upload cap. Rather than
 * reject them, downscale to a sensible web-display dimension and re-encode JPEG
 * at adaptive quality until we're under budget.
 *
 * Uses createImageBitmap to respect EXIF orientation — important for iPhone shots
 * which embed a rotation flag rather than rotating pixels.
 *
 * Returns the original File untouched if it's already small and in a web format,
 * or a new File (always image/jpeg) if compression ran. Falls back to the original
 * if anything in the pipeline errors.
 */

const DEFAULTS = {
  maxDimension: 1920,           // longest edge, in pixels
  maxFileSize: 4 * 1024 * 1024, // aim for 4MB to leave headroom under server's 5MB cap
  initialQuality: 0.85,
  minQuality: 0.5,
}

export async function compressImage(file, options = {}) {
  const opts = { ...DEFAULTS, ...options }

  // Already small enough and in a format the server accepts — pass through
  if (file.size <= opts.maxFileSize && /^image\/(jpeg|webp)$/.test(file.type)) {
    return file
  }

  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch (err) {
    console.warn('compressImage: createImageBitmap failed, returning original', err)
    return file
  }

  let { width, height } = bitmap
  const longest = Math.max(width, height)
  if (longest > opts.maxDimension) {
    const scale = opts.maxDimension / longest
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close?.()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  let quality = opts.initialQuality
  let blob = await canvasToBlob(canvas, quality)
  while (blob && blob.size > opts.maxFileSize && quality > opts.minQuality) {
    quality = Math.max(opts.minQuality, quality - 0.1)
    blob = await canvasToBlob(canvas, quality)
  }

  if (!blob) return file

  const newName = file.name.replace(/\.[^.]+$/, '.jpg') || 'photo.jpg'
  return new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() })
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

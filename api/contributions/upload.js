/**
 * POST /api/contributions/upload
 *
 * Upload a photo for contributions.
 *
 * SETUP REQUIRED:
 * 1. npm install @vercel/blob
 * 2. In Vercel dashboard: Storage > Create Store > Blob
 * 3. Connect to project (auto-adds BLOB_READ_WRITE_TOKEN)
 *
 * Returns: { url: string }
 */

import { requireAuth } from '../lib/auth.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'

// Try to import Vercel Blob - may not be installed
let put = null
async function getBlob() {
  if (put === null) {
    try {
      const blob = await import('@vercel/blob')
      put = blob.put
    } catch {
      put = false
    }
  }
  return put
}

export const config = {
  api: {
    bodyParser: false
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limit uploads
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, 'upload')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  // Require authentication
  const user = await requireAuth(req, res)
  if (!user) return

  // Check if Vercel Blob is available
  const blobPut = await getBlob()
  if (!blobPut) {
    return res.status(501).json({
      error: 'Photo uploads not configured',
      message: 'Please install @vercel/blob and configure Blob storage'
    })
  }

  try {
    // Validate content type — strict allowlist (no SVG, no HTML masquerading
    // as image/foo). The header is still client-controlled but at minimum the
    // file extension we save can't be an executable type.
    const CONTENT_TYPE_TO_EXT = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/heic': 'heic',
      'image/heif': 'heif',
    }
    const rawContentType = req.headers['content-type'] || ''
    // Some clients append "; charset=..." — strip params for the lookup.
    const contentType = rawContentType.split(';')[0].trim().toLowerCase()
    const ext = CONTENT_TYPE_TO_EXT[contentType]
    if (!ext) {
      return res.status(400).json({ error: 'Only JPEG, PNG, GIF, WebP, or HEIC images are allowed' })
    }

    // Validate file size (max 5MB). Content-Length is client-controlled —
    // a more robust enforcement happens at the Vercel edge body-size limit
    // (4.5MB on Hobby, 100kB above which uploads stream) and inside the Blob
    // client when it reads the stream. This header check rejects the
    // obvious cases without spending the upload bandwidth.
    const contentLength = parseInt(req.headers['content-length'], 10)
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      return res.status(400).json({ error: 'Missing or invalid Content-Length' })
    }
    if (contentLength > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'File too large. Maximum size is 5MB' })
    }

    // Generate unique filename — extension comes from our allowlist, NOT
    // the raw content-type string (which could be "image/../../etc.html").
    const filename = `contributions/${user.id}/${Date.now()}.${ext}`

    // TODO(privacy): strip EXIF before storing. JPEG/HEIC from iOS contain
    // GPS coordinates in metadata. Two options:
    //   1. Server-side: install `sharp` and `sharp(buf).rotate().toBuffer()`
    //      (which discards EXIF by default). Heavy cold-start hit on Vercel.
    //   2. Client-side: pre-process the image through canvas.toBlob() before
    //      upload — canvas strips EXIF naturally. Cheaper, but only effective
    //      if every upload path goes through that helper.
    // Until then, our privacy policy must disclose precise-location storage,
    // and Apple's App Store data-collection disclosures must match.

    // Upload to Vercel Blob
    const blob = await blobPut(filename, req, {
      access: 'public',
      contentType
    })

    return res.status(200).json({
      success: true,
      url: blob.url
    })
  } catch (error) {
    console.error('Upload error:', error)
    return res.status(500).json({ error: 'Upload failed' })
  }
}

export default withCors(handler)

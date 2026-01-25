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

/* global process */
import { requireAuth } from '../lib/auth.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

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

export default async function handler(req, res) {
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
    // Validate content type
    const contentType = req.headers['content-type']
    if (!contentType || !contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'Only image uploads are allowed' })
    }

    // Validate file size (max 5MB)
    const contentLength = parseInt(req.headers['content-length'], 10)
    if (contentLength > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'File too large. Maximum size is 5MB' })
    }

    // Generate unique filename
    const ext = contentType.split('/')[1] || 'jpg'
    const filename = `contributions/${user.id}/${Date.now()}.${ext}`

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

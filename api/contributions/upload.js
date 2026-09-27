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
import { isFeatureEnabled } from '../lib/flags.js'

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

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

// Read the body with a hard cap (Content-Length is client-controlled).
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_UPLOAD_BYTES) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

// Read the EXIF Orientation tag (0x0112) from an APP1 Exif payload.
function readExifOrientation(payload) {
  try {
    if (payload.toString('latin1', 0, 6) !== 'Exif\0\0') return 1
    const tiff = payload.subarray(6)
    const le = tiff[0] === 0x49
    const r16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o))
    const ifd = le ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4)
    const count = r16(ifd)
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12
      if (r16(entry) === 0x0112) return r16(entry + 8)
    }
  } catch {
    // Truncated or malformed EXIF: treat as no orientation
  }
  return 1
}

// Minimal APP1 Exif segment carrying only the Orientation tag, so phone
// photos that rely on it still display upright after the strip.
function orientationSegment(orientation) {
  const seg = Buffer.alloc(36)
  seg.writeUInt16BE(0xFFE1, 0)
  seg.writeUInt16BE(34, 2)
  seg.write('Exif\0\0', 4, 'latin1')
  seg.write('MM', 10, 'latin1')
  seg.writeUInt16BE(42, 12)
  seg.writeUInt32BE(8, 14)
  seg.writeUInt16BE(1, 18) // one IFD0 entry
  seg.writeUInt16BE(0x0112, 20) // Orientation
  seg.writeUInt16BE(3, 22) // SHORT
  seg.writeUInt32BE(1, 24)
  seg.writeUInt16BE(orientation, 28)
  // bytes 30-35: value padding + next IFD offset 0
  return seg
}

/**
 * Drop APP1 (Exif/XMP, where GPS lives) and APP13 (IPTC) segments from a
 * JPEG, keeping only the Orientation tag. Returns the input unchanged when it
 * is not a JPEG, and null when it claims to be one but is malformed.
 */
export function stripJpegMetadata(buf) {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return buf
  const parts = [buf.subarray(0, 2)]
  let keptOrientation = false
  let pos = 2
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xFF) return null
    const marker = buf[pos + 1]
    if (marker === 0xFF) { pos++; continue } // fill byte
    if (marker === 0xDA || marker === 0xD9) {
      parts.push(buf.subarray(pos)) // start of scan / end: image data follows
      return Buffer.concat(parts)
    }
    const end = pos + 2 + buf.readUInt16BE(pos + 2)
    if (end > buf.length || end < pos + 4) return null
    if (marker === 0xE1) {
      const orientation = readExifOrientation(buf.subarray(pos + 4, end))
      if (!keptOrientation && orientation > 1 && orientation <= 8) {
        parts.push(orientationSegment(orientation))
        keptOrientation = true
      }
    } else if (marker !== 0xED) {
      parts.push(buf.subarray(pos, end))
    }
    pos = end
  }
  return null
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

  // Kill-switch: instantly stop accepting uploads (KV flag, no deploy) if
  // they become a cost/abuse vector during an influx. Fails open.
  if (!(await isFeatureEnabled('contributionsUpload'))) {
    return res.status(503).json({ error: 'Photo uploads are temporarily disabled' })
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
    if (contentLength > MAX_UPLOAD_BYTES) {
      return res.status(400).json({ error: 'File too large. Maximum size is 5MB' })
    }

    // Generate unique filename — extension comes from our allowlist, NOT
    // the raw content-type string (which could be "image/../../etc.html").
    const filename = `contributions/${user.id}/${Date.now()}.${ext}`

    // Photos are public: strip JPEG EXIF/XMP (GPS) server-side. Detected by
    // magic bytes, not the client-controlled content-type.
    // ponytail: JPEG only. PNG eXIf, WebP EXIF and HEIC metadata still pass
    // through; add a parser (or sharp) if those formats show up with GPS.
    const raw = await readBody(req)
    if (!raw) {
      return res.status(400).json({ error: 'File too large. Maximum size is 5MB' })
    }
    const body = stripJpegMetadata(raw)
    if (!body) {
      return res.status(400).json({ error: 'Invalid image file' })
    }

    // Upload to Vercel Blob
    const blob = await blobPut(filename, body, {
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

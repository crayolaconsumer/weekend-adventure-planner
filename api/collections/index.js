/**
 * GET/POST /api/collections
 *
 * Manage collections for authenticated users.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, insert } from '../lib/db.js'
import { validateCollectionName, validateEmoji, sanitizeString } from '../lib/validation.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

// Safe JSON parse helper
const safeJsonParse = (data, defaultValue = {}) => {
  if (!data) return defaultValue
  if (typeof data === 'object') return data
  try {
    return JSON.parse(data)
  } catch {
    return defaultValue
  }
}

export default async function handler(req, res) {
  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res, user)
      case 'POST':
        return await handlePost(req, res, user)
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('Collections error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * GET - Retrieve all collections for user
 */
async function handleGet(req, res, user) {
  const collections = await query(
    `SELECT c.id, c.name, c.emoji, c.description, c.is_public, c.created_at, c.updated_at,
            COUNT(cp.id) as place_count
     FROM collections c
     LEFT JOIN collection_places cp ON c.id = cp.collection_id
     WHERE c.user_id = ?
     GROUP BY c.id
     ORDER BY c.updated_at DESC`,
    [user.id]
  )

  // Get places for each collection
  const collectionsWithPlaces = await Promise.all(
    collections.map(async (col) => {
      const places = await query(
        `SELECT place_id, place_data, note, added_at
         FROM collection_places
         WHERE collection_id = ?
         ORDER BY added_at DESC`,
        [col.id]
      )

      return {
        id: col.id,
        name: col.name,
        emoji: col.emoji || '📍',
        description: col.description || '',
        visibility: col.is_public ? 'public' : 'private',
        placeCount: col.place_count,
        places: places.map(p => ({
          placeId: p.place_id,
          placeData: safeJsonParse(p.place_data),
          note: p.note,
          addedAt: new Date(p.added_at).getTime()
        })),
        createdAt: new Date(col.created_at).getTime(),
        updatedAt: new Date(col.updated_at).getTime()
      }
    })
  )

  return res.status(200).json({ collections: collectionsWithPlaces })
}

/**
 * POST - Create a new collection
 */
async function handlePost(req, res, user) {
  // Rate limit collection creation
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, 'collections:create')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const { name, emoji = '📍', description = '', visibility = 'private' } = req.body

  // Validate collection name
  const nameValidation = validateCollectionName(name)
  if (!nameValidation.valid) {
    return res.status(400).json({ error: nameValidation.message })
  }

  // Validate emoji
  const emojiValidation = validateEmoji(emoji)
  if (!emojiValidation.valid) {
    return res.status(400).json({ error: emojiValidation.message })
  }

  // Sanitize and limit description
  const sanitizedDescription = sanitizeString(description).slice(0, 200)

  // Validate visibility
  if (visibility !== 'public' && visibility !== 'private') {
    return res.status(400).json({ error: 'visibility must be public or private' })
  }

  const isPublic = visibility === 'public' ? 1 : 0

  const collectionId = await insert(
    `INSERT INTO collections (user_id, name, emoji, description, is_public)
     VALUES (?, ?, ?, ?, ?)`,
    [user.id, sanitizeString(name).slice(0, 40), emoji, sanitizedDescription, isPublic]
  )

  return res.status(201).json({
    success: true,
    collection: {
      id: collectionId,
      name: sanitizeString(name).slice(0, 40),
      emoji,
      description: sanitizedDescription,
      visibility,
      placeCount: 0,
      places: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  })
}

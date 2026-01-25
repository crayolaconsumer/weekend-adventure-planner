/**
 * GET/PUT/DELETE /api/collections/[id]
 * POST /api/collections/[id]/places
 * DELETE /api/collections/[id]/places?placeId=xxx
 *
 * Manage individual collection and its places.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, update, insert } from '../lib/db.js'
import { validateId, validateCollectionName, validateContent, validateEmoji } from '../lib/validation.js'
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

  const { id } = req.query

  // Validate collection ID format
  const idValidation = validateId(id)
  if (!idValidation.valid) {
    return res.status(400).json({ error: 'Invalid collection ID' })
  }
  const collectionId = idValidation.id

  try {
    // Check ownership
    const collection = await queryOne(
      'SELECT * FROM collections WHERE id = ? AND user_id = ?',
      [collectionId, user.id]
    )

    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' })
    }

    switch (req.method) {
      case 'GET':
        return await handleGet(req, res, collection)
      case 'PUT': {
        // Rate limit collection updates
        const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, 'collections:update')
        if (rateLimitError) {
          return res.status(rateLimitError.status).json(rateLimitError)
        }
        return await handlePut(req, res, collection)
      }
      case 'DELETE':
        return await handleDelete(req, res, collection)
      case 'POST': {
        // Rate limit adding places to collections
        const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, 'collections:addPlace')
        if (rateLimitError) {
          return res.status(rateLimitError.status).json(rateLimitError)
        }
        return await handleAddPlace(req, res, collection)
      }
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('Collection error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * GET - Get collection with places
 */
async function handleGet(req, res, collection) {
  const places = await query(
    `SELECT place_id, place_data, note, added_at
     FROM collection_places
     WHERE collection_id = ?
     ORDER BY added_at DESC`,
    [collection.id]
  )

  return res.status(200).json({
    collection: {
      id: collection.id,
      name: collection.name,
      emoji: collection.emoji || '📍',
      description: collection.description || '',
      visibility: collection.is_public ? 'public' : 'private',
      places: places.map(p => ({
        placeId: p.place_id,
        placeData: safeJsonParse(p.place_data),
        note: p.note,
        addedAt: new Date(p.added_at).getTime()
      })),
      createdAt: new Date(collection.created_at).getTime(),
      updatedAt: new Date(collection.updated_at).getTime()
    }
  })
}

/**
 * PUT - Update collection
 */
async function handlePut(req, res, collection) {
  const { name, emoji, description, visibility } = req.body

  // Validate name if provided
  if (name !== undefined) {
    const nameValidation = validateCollectionName(name)
    if (!nameValidation.valid) {
      return res.status(400).json({ error: nameValidation.message })
    }
  }

  // Validate description max length
  if (description !== undefined && description.length > 200) {
    return res.status(400).json({ error: 'Description must be 200 characters or less' })
  }

  const updates = []
  const params = []

  if (name !== undefined) {
    updates.push('name = ?')
    params.push(name.trim().slice(0, 40))
  }
  if (emoji !== undefined) {
    const emojiValidation = validateEmoji(emoji)
    if (!emojiValidation.valid) {
      return res.status(400).json({ error: emojiValidation.message })
    }
    updates.push('emoji = ?')
    params.push(emoji)
  }
  if (description !== undefined) {
    updates.push('description = ?')
    params.push(description ? description.slice(0, 200) : '')
  }
  if (visibility !== undefined) {
    updates.push('is_public = ?')
    params.push(visibility === 'public' ? 1 : 0)
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No updates provided' })
  }

  params.push(collection.id)

  await update(
    `UPDATE collections SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
    params
  )

  return res.status(200).json({ success: true })
}

/**
 * DELETE - Delete collection
 */
async function handleDelete(req, res, collection) {
  const { placeId } = req.query

  // If placeId provided, remove place from collection
  if (placeId) {
    const affected = await update(
      'DELETE FROM collection_places WHERE collection_id = ? AND place_id = ?',
      [collection.id, placeId]
    )

    await update('UPDATE collections SET updated_at = NOW() WHERE id = ?', [collection.id])

    return res.status(200).json({ success: true, deleted: affected > 0 })
  }

  // Otherwise delete entire collection
  await update('DELETE FROM collection_places WHERE collection_id = ?', [collection.id])
  await update('DELETE FROM collections WHERE id = ?', [collection.id])

  return res.status(200).json({ success: true })
}

/**
 * POST - Add place to collection
 */
// Maximum JSON data size (10KB)
const MAX_JSON_SIZE = 10 * 1024

async function handleAddPlace(req, res, collection) {
  const { placeId, placeData, note = null } = req.body

  if (!placeId) {
    return res.status(400).json({ error: 'placeId is required' })
  }

  // Validate note length if provided
  if (note && note.length > 500) {
    return res.status(400).json({ error: 'Note must be 500 characters or less' })
  }

  // Validate JSON size
  if (placeData) {
    const placeDataJson = JSON.stringify(placeData)
    if (placeDataJson.length > MAX_JSON_SIZE) {
      return res.status(400).json({ error: 'Place data too large (max 10KB)' })
    }
  }

  // Check if already in collection
  const existing = await queryOne(
    'SELECT id FROM collection_places WHERE collection_id = ? AND place_id = ?',
    [collection.id, placeId]
  )

  if (existing) {
    return res.status(200).json({ success: true, alreadyExists: true })
  }

  await insert(
    `INSERT INTO collection_places (collection_id, place_id, place_data, note, added_at)
     VALUES (?, ?, ?, ?, NOW())`,
    [collection.id, placeId, placeData ? JSON.stringify(placeData) : null, note]
  )

  await update('UPDATE collections SET updated_at = NOW() WHERE id = ?', [collection.id])

  return res.status(201).json({ success: true })
}

/**
 * Input Validation Utilities
 *
 * Centralized validation functions for API inputs.
 * All functions return { valid: boolean, message?: string }
 */

/**
 * Validate geographic coordinates
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {{ valid: boolean, message?: string }}
 */
export function validateCoordinates(lat, lng) {
  if (typeof lat !== 'number' || isNaN(lat)) {
    return { valid: false, message: 'Latitude must be a valid number' }
  }
  if (typeof lng !== 'number' || isNaN(lng)) {
    return { valid: false, message: 'Longitude must be a valid number' }
  }
  if (lat < -90 || lat > 90) {
    return { valid: false, message: 'Latitude must be between -90 and 90' }
  }
  if (lng < -180 || lng > 180) {
    return { valid: false, message: 'Longitude must be between -180 and 180' }
  }
  return { valid: true }
}

/**
 * Parse and validate coordinates from query/body
 * Handles string or number inputs
 * @param {any} lat - Latitude value
 * @param {any} lng - Longitude value
 * @returns {{ valid: boolean, lat?: number, lng?: number, message?: string }}
 */
export function parseCoordinates(lat, lng) {
  const parsedLat = typeof lat === 'string' ? parseFloat(lat) : lat
  const parsedLng = typeof lng === 'string' ? parseFloat(lng) : lng

  const validation = validateCoordinates(parsedLat, parsedLng)
  if (!validation.valid) {
    return validation
  }

  return { valid: true, lat: parsedLat, lng: parsedLng }
}

/**
 * Validate collection name
 * @param {string} name - Collection name
 * @returns {{ valid: boolean, message?: string }}
 */
export function validateCollectionName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, message: 'Collection name is required' }
  }

  const trimmed = name.trim()

  if (trimmed.length === 0) {
    return { valid: false, message: 'Collection name cannot be empty' }
  }

  if (trimmed.length > 40) {
    return { valid: false, message: 'Collection name must be 40 characters or less' }
  }

  // Check for potentially malicious content
  if (/<script|javascript:|data:/i.test(trimmed)) {
    return { valid: false, message: 'Collection name contains invalid characters' }
  }

  return { valid: true }
}

/**
 * Validate emoji (single emoji character)
 * Uses a regex pattern that matches most emoji
 * @param {string} emoji - Emoji string
 * @returns {{ valid: boolean, message?: string }}
 */
export function validateEmoji(emoji) {
  if (!emoji || typeof emoji !== 'string') {
    return { valid: false, message: 'Emoji is required' }
  }

  // Emoji regex pattern - matches common emoji including compound emoji
  // This is a simplified pattern; for production, consider a library like emoji-regex
  const emojiPattern = /^[\p{Emoji}\p{Emoji_Component}]+$/u

  // Allow common emoji ranges and emoji sequences
  // Length check: most emoji are 1-4 characters due to ZWJ sequences
  if (emoji.length > 8) {
    return { valid: false, message: 'Invalid emoji' }
  }

  // Basic check for emoji-like content
  if (!emojiPattern.test(emoji) && !/[\u{1F300}-\u{1FAD6}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(emoji)) {
    return { valid: false, message: 'Invalid emoji' }
  }

  return { valid: true }
}

/**
 * Validate plan title
 * @param {string} title - Plan title
 * @returns {{ valid: boolean, message?: string }}
 */
export function validatePlanTitle(title) {
  if (!title || typeof title !== 'string') {
    return { valid: false, message: 'Title is required' }
  }

  const trimmed = title.trim()

  if (trimmed.length === 0) {
    return { valid: false, message: 'Title cannot be empty' }
  }

  if (trimmed.length > 100) {
    return { valid: false, message: 'Title must be 100 characters or less' }
  }

  // Check for potentially malicious content
  if (/<script|javascript:|data:/i.test(trimmed)) {
    return { valid: false, message: 'Title contains invalid characters' }
  }

  return { valid: true }
}

/**
 * Validate content text (tips, stories, etc.)
 * @param {string} content - Content text
 * @param {number} maxLength - Maximum allowed length
 * @returns {{ valid: boolean, message?: string }}
 */
export function validateContent(content, maxLength = 280) {
  if (!content || typeof content !== 'string') {
    return { valid: false, message: 'Content is required' }
  }

  const trimmed = content.trim()

  if (trimmed.length === 0) {
    return { valid: false, message: 'Content cannot be empty' }
  }

  if (trimmed.length > maxLength) {
    return { valid: false, message: `Content must be ${maxLength} characters or less` }
  }

  // Check for potentially malicious content
  if (/<script|javascript:|data:/i.test(trimmed)) {
    return { valid: false, message: 'Content contains invalid characters' }
  }

  return { valid: true }
}

/**
 * Validate share code format
 * @param {string} code - Share code
 * @returns {{ valid: boolean, message?: string }}
 */
export function validateShareCode(code) {
  if (!code || typeof code !== 'string') {
    return { valid: false, message: 'Share code is required' }
  }

  // Share codes are 16 characters, alphanumeric (lowercase)
  if (!/^[a-z0-9]{12,16}$/.test(code)) {
    return { valid: false, message: 'Invalid share code format' }
  }

  return { valid: true }
}

/**
 * Validate pagination parameters
 * @param {any} limit - Limit value
 * @param {any} offset - Offset value
 * @param {number} maxLimit - Maximum allowed limit
 * @returns {{ valid: boolean, limit?: number, offset?: number, message?: string }}
 */
export function validatePagination(limit, offset, maxLimit = 100) {
  let parsedLimit = parseInt(limit, 10)
  let parsedOffset = parseInt(offset, 10)

  if (isNaN(parsedLimit) || parsedLimit < 1) {
    parsedLimit = 20 // Default
  }

  if (isNaN(parsedOffset) || parsedOffset < 0) {
    parsedOffset = 0 // Default
  }

  if (parsedLimit > maxLimit) {
    parsedLimit = maxLimit
  }

  return { valid: true, limit: parsedLimit, offset: parsedOffset }
}

/**
 * Validate integer ID
 * @param {any} id - ID value
 * @returns {{ valid: boolean, id?: number, message?: string }}
 */
export function validateId(id) {
  const parsed = parseInt(id, 10)

  if (isNaN(parsed) || parsed < 1 || parsed > Number.MAX_SAFE_INTEGER) {
    return { valid: false, message: 'Invalid ID' }
  }

  return { valid: true, id: parsed }
}

/**
 * Validate OSM-style place ID (e.g., "node/12345", "way/67890")
 * @param {any} placeId - Place ID value
 * @returns {{ valid: boolean, placeId?: string, message?: string }}
 */
export function validatePlaceId(placeId) {
  if (typeof placeId !== 'string' || !placeId) {
    return { valid: false, message: 'Place ID must be a non-empty string' }
  }

  // OSM-style IDs: node/12345, way/67890, relation/111
  // Also allow plain numeric strings for compatibility
  const osmPattern = /^(node|way|relation)\/\d+$/
  const numericPattern = /^\d+$/

  if (!osmPattern.test(placeId) && !numericPattern.test(placeId)) {
    return { valid: false, message: 'Invalid place ID format' }
  }

  // Limit length to prevent abuse
  if (placeId.length > 50) {
    return { valid: false, message: 'Place ID too long' }
  }

  return { valid: true, placeId }
}

/**
 * Sanitize string for safe database storage
 * Removes null bytes and trims whitespace
 * @param {string} str - Input string
 * @returns {string} Sanitized string
 */
export function sanitizeString(str) {
  if (typeof str !== 'string') return ''
  return str.replace(/\0/g, '').trim()
}

/**
 * Whitelist object fields
 * Returns new object with only allowed fields
 * @param {Object} obj - Input object
 * @param {string[]} allowedFields - Array of allowed field names
 * @returns {Object} Filtered object
 */
export function whitelistFields(obj, allowedFields) {
  if (!obj || typeof obj !== 'object') return {}

  const result = {}
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(obj, field)) {
      result[field] = obj[field]
    }
  }
  return result
}

export default {
  validateCoordinates,
  parseCoordinates,
  validateCollectionName,
  validateEmoji,
  validatePlaceId,
  validatePlanTitle,
  validateContent,
  validateShareCode,
  validatePagination,
  validateId,
  sanitizeString,
  whitelistFields
}

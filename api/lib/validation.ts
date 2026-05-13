/**
 * Input Validation Utilities
 *
 * Centralized validation functions for API inputs.
 * All functions return { valid: boolean, message?: string } unless
 * they also parse and return the parsed value.
 */

export interface ValidationResult {
  valid: boolean
  message?: string
}

export interface ParsedCoordinatesResult extends ValidationResult {
  lat?: number
  lng?: number
}

export interface PaginationResult extends ValidationResult {
  limit?: number
  offset?: number
}

export interface IdResult extends ValidationResult {
  id?: number
}

export interface PlaceIdResult extends ValidationResult {
  placeId?: string
}

/** Validate geographic coordinates */
export function validateCoordinates(lat: unknown, lng: unknown): ValidationResult {
  if (typeof lat !== 'number' || Number.isNaN(lat)) {
    return { valid: false, message: 'Latitude must be a valid number' }
  }
  if (typeof lng !== 'number' || Number.isNaN(lng)) {
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

/** Parse and validate coordinates from query/body (string or number) */
export function parseCoordinates(lat: unknown, lng: unknown): ParsedCoordinatesResult {
  const parsedLat = typeof lat === 'string' ? parseFloat(lat) : lat
  const parsedLng = typeof lng === 'string' ? parseFloat(lng) : lng

  const validation = validateCoordinates(parsedLat, parsedLng)
  if (!validation.valid) {
    return validation
  }

  return { valid: true, lat: parsedLat as number, lng: parsedLng as number }
}

/** Validate collection name */
export function validateCollectionName(name: unknown): ValidationResult {
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

  if (/<script|javascript:|data:/i.test(trimmed)) {
    return { valid: false, message: 'Collection name contains invalid characters' }
  }

  return { valid: true }
}

/** Validate emoji */
export function validateEmoji(emoji: unknown): ValidationResult {
  if (!emoji || typeof emoji !== 'string') {
    return { valid: false, message: 'Emoji is required' }
  }

  const emojiPattern = /^[\p{Emoji}\p{Emoji_Component}]+$/u

  if (emoji.length > 8) {
    return { valid: false, message: 'Invalid emoji' }
  }

  if (!emojiPattern.test(emoji) && !/[\u{1F300}-\u{1FAD6}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(emoji)) {
    return { valid: false, message: 'Invalid emoji' }
  }

  return { valid: true }
}

/** Validate plan title */
export function validatePlanTitle(title: unknown): ValidationResult {
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

  if (/<script|javascript:|data:/i.test(trimmed)) {
    return { valid: false, message: 'Title contains invalid characters' }
  }

  return { valid: true }
}

/** Validate content text (tips, stories, etc.) */
export function validateContent(content: unknown, maxLength: number = 280): ValidationResult {
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

  if (/<script|javascript:|data:/i.test(trimmed)) {
    return { valid: false, message: 'Content contains invalid characters' }
  }

  return { valid: true }
}

/** Validate share code format (12-16 char alphanumeric lowercase) */
export function validateShareCode(code: unknown): ValidationResult {
  if (!code || typeof code !== 'string') {
    return { valid: false, message: 'Share code is required' }
  }

  if (!/^[a-z0-9]{12,16}$/.test(code)) {
    return { valid: false, message: 'Invalid share code format' }
  }

  return { valid: true }
}

/** Validate pagination parameters */
export function validatePagination(limit: unknown, offset: unknown, maxLimit: number = 100): PaginationResult {
  let parsedLimit = parseInt(String(limit), 10)
  let parsedOffset = parseInt(String(offset), 10)

  if (Number.isNaN(parsedLimit) || parsedLimit < 1) {
    parsedLimit = 20 // Default
  }

  if (Number.isNaN(parsedOffset) || parsedOffset < 0) {
    parsedOffset = 0 // Default
  }

  if (parsedLimit > maxLimit) {
    parsedLimit = maxLimit
  }

  return { valid: true, limit: parsedLimit, offset: parsedOffset }
}

/** Validate integer ID */
export function validateId(id: unknown): IdResult {
  const parsed = parseInt(String(id), 10)

  if (Number.isNaN(parsed) || parsed < 1 || parsed > Number.MAX_SAFE_INTEGER) {
    return { valid: false, message: 'Invalid ID' }
  }

  return { valid: true, id: parsed }
}

/** Validate place ID in various formats */
export function validatePlaceId(placeId: unknown): PlaceIdResult {
  if (typeof placeId !== 'string' || !placeId) {
    return { valid: false, message: 'Place ID must be a non-empty string' }
  }

  // Supported formats:
  //   - OSM-style: node/12345, way/67890, relation/111
  //   - Plain numeric: 12345
  //   - Wikipedia: wiki_12345678
  const osmPattern = /^(node|way|relation)\/\d+$/
  const numericPattern = /^\d+$/
  const wikiPattern = /^wiki_\d+$/

  if (!osmPattern.test(placeId) && !numericPattern.test(placeId) && !wikiPattern.test(placeId)) {
    return { valid: false, message: 'Invalid place ID format' }
  }

  if (placeId.length > 50) {
    return { valid: false, message: 'Place ID too long' }
  }

  return { valid: true, placeId }
}

/** Sanitize string for safe database storage */
export function sanitizeString(str: unknown): string {
  if (typeof str !== 'string') return ''
  return str.replace(/\0/g, '').trim()
}

/** Whitelist object fields — returns new object with only allowed fields */
export function whitelistFields<T extends Record<string, unknown>>(
  obj: T | null | undefined | unknown,
  allowedFields: string[],
): Partial<T> {
  if (!obj || typeof obj !== 'object') return {}

  const result: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(obj, field)) {
      result[field] = (obj as Record<string, unknown>)[field]
    }
  }
  return result as Partial<T>
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
  whitelistFields,
}

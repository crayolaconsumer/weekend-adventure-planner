/**
 * Collections Storage
 *
 * User-created collections of places with CRUD operations.
 */

const COLLECTIONS_KEY = 'roam_collections'

/**
 * Collection data structure
 * @typedef {Object} Collection
 * @property {string} id - Unique collection ID
 * @property {string} name - Collection name
 * @property {string} description - Collection description
 * @property {string} emoji - Collection emoji icon
 * @property {'private'|'public'|'unlisted'} visibility - Visibility setting
 * @property {Array<{placeId: string, addedAt: number, note: string|null}>} places - Places in collection
 * @property {number} createdAt - Creation timestamp
 * @property {number} updatedAt - Last update timestamp
 */

/**
 * Generate unique ID
 */
function generateId() {
  return `col_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Get all collections
 * @returns {Collection[]}
 */
export function getAllCollections() {
  try {
    const data = localStorage.getItem(COLLECTIONS_KEY)
    return data ? JSON.parse(data) : []
  } catch (error) {
    console.error('Error reading collections:', error)
    return []
  }
}

/**
 * Get a single collection by ID
 * @param {string} collectionId
 * @returns {Collection|null}
 */
export function getCollection(collectionId) {
  const collections = getAllCollections()
  return collections.find(c => c.id === collectionId) || null
}

/**
 * Create a new collection
 * @param {Partial<Collection>} data
 * @returns {Collection}
 */
export function createCollection(data) {
  const collections = getAllCollections()

  const newCollection = {
    id: generateId(),
    name: data.name || 'New Collection',
    description: data.description || '',
    emoji: data.emoji || '📍',
    visibility: data.visibility || 'private',
    places: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  collections.push(newCollection)
  localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections))

  return newCollection
}

/**
 * Update a collection
 * @param {string} collectionId
 * @param {Partial<Collection>} updates
 * @returns {Collection|null}
 */
export function updateCollection(collectionId, updates) {
  const collections = getAllCollections()
  const index = collections.findIndex(c => c.id === collectionId)

  if (index === -1) return null

  collections[index] = {
    ...collections[index],
    ...updates,
    updatedAt: Date.now()
  }

  localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections))
  return collections[index]
}

/**
 * Delete a collection
 * @param {string} collectionId
 * @returns {boolean}
 */
export function deleteCollection(collectionId) {
  const collections = getAllCollections()
  const filtered = collections.filter(c => c.id !== collectionId)

  if (filtered.length === collections.length) return false

  localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(filtered))
  return true
}

/**
 * Add a place to a collection
 * @param {string} collectionId
 * @param {string} placeId
 * @param {string|null} note
 * @returns {boolean}
 */
export function addPlaceToCollection(collectionId, placeId, note = null) {
  const collections = getAllCollections()
  const collection = collections.find(c => c.id === collectionId)

  if (!collection) return false

  // Check if place already exists
  if (collection.places.some(p => p.placeId === placeId)) {
    return false
  }

  collection.places.push({
    placeId,
    addedAt: Date.now(),
    note
  })
  collection.updatedAt = Date.now()

  localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections))
  return true
}

/**
 * Remove a place from a collection
 * @param {string} collectionId
 * @param {string} placeId
 * @returns {boolean}
 */
export function removePlaceFromCollection(collectionId, placeId) {
  const collections = getAllCollections()
  const collection = collections.find(c => c.id === collectionId)

  if (!collection) return false

  const initialLength = collection.places.length
  collection.places = collection.places.filter(p => p.placeId !== placeId)

  if (collection.places.length === initialLength) return false

  collection.updatedAt = Date.now()
  localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections))
  return true
}

/**
 * Get collections containing a specific place
 * @param {string} placeId
 * @returns {Collection[]}
 */
export function getCollectionsForPlace(placeId) {
  const collections = getAllCollections()
  return collections.filter(c => c.places.some(p => p.placeId === placeId))
}

/**
 * Check if a place is in any collection
 * @param {string} placeId
 * @returns {boolean}
 */
export function isPlaceInAnyCollection(placeId) {
  return getCollectionsForPlace(placeId).length > 0
}

/**
 * Get collection count
 * @returns {number}
 */
export function getCollectionCount() {
  return getAllCollections().length
}

/**
 * Default emoji options for collections
 */
export const COLLECTION_EMOJIS = [
  '📍', '❤️', '⭐', '🎯', '🏆', '💎', '🌟', '🔥',
  '☕', '🍽️', '🍺', '🎭', '🏛️', '🌳', '🏖️', '⛰️',
  '🎨', '📸', '🎵', '🛍️', '💕', '👨‍👩‍👧', '🐕', '🌙'
]

/**
 * Curated collections (read-only, editorial picks)
 */
export const CURATED_COLLECTIONS = [
  {
    id: 'curated_rainy_day',
    name: 'Rainy Day Escapes',
    description: 'Indoor activities for when the weather turns',
    emoji: '🌧️',
    visibility: 'public',
    isCurated: true,
    tags: ['indoor', 'museum', 'cafe', 'cinema']
  },
  {
    id: 'curated_date_night',
    name: 'Date Night Ideas',
    description: 'Romantic spots for a special evening',
    emoji: '💕',
    visibility: 'public',
    isCurated: true,
    tags: ['restaurant', 'bar', 'romantic', 'evening']
  },
  {
    id: 'curated_family',
    name: 'Family Day Out',
    description: 'Fun for all ages',
    emoji: '👨‍👩‍👧',
    visibility: 'public',
    isCurated: true,
    tags: ['park', 'museum', 'playground', 'family']
  },
  {
    id: 'curated_hidden_gems',
    name: 'Hidden Gems',
    description: 'Off the beaten path discoveries',
    emoji: '💎',
    visibility: 'public',
    isCurated: true,
    tags: ['unique', 'local', 'independent']
  }
]

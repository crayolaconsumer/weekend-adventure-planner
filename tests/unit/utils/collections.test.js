import { describe, it, expect, beforeEach } from 'vitest'
import {
  getAllCollections,
  getCollection,
  createCollection,
  updateCollection,
  deleteCollection,
  addPlaceToCollection,
  removePlaceFromCollection,
  getCollectionsForPlace,
  isPlaceInAnyCollection,
  getCollectionCount,
  COLLECTION_EMOJIS,
  CURATED_COLLECTIONS,
} from '../../../src/utils/collections.js'

describe('collections', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('getAllCollections', () => {
    it('returns [] when storage empty', () => {
      expect(getAllCollections()).toEqual([])
    })

    it('returns [] on corrupt JSON', () => {
      localStorage.setItem('roam_collections', 'not json')
      expect(getAllCollections()).toEqual([])
    })
  })

  describe('createCollection', () => {
    it('persists with sane defaults', () => {
      const c = createCollection({ name: 'Pubs' })
      expect(c.id).toMatch(/^col_/)
      expect(c.name).toBe('Pubs')
      expect(c.emoji).toBe('📍')
      expect(c.visibility).toBe('private')
      expect(c.places).toEqual([])
      expect(typeof c.createdAt).toBe('number')
    })

    it('accepts overrides', () => {
      const c = createCollection({ name: 'X', emoji: '🌳', visibility: 'public', description: 'hi' })
      expect(c.emoji).toBe('🌳')
      expect(c.visibility).toBe('public')
      expect(c.description).toBe('hi')
    })

    it('persists via localStorage', () => {
      createCollection({ name: 'Pubs' })
      expect(getCollectionCount()).toBe(1)
    })

    it('returns null from getCollection for unknown id', () => {
      expect(getCollection('nope')).toBe(null)
    })

    it('round-trips via getCollection', () => {
      const c = createCollection({ name: 'Pubs' })
      expect(getCollection(c.id)?.name).toBe('Pubs')
    })
  })

  describe('updateCollection', () => {
    it('returns null for unknown id', () => {
      expect(updateCollection('nope', { name: 'X' })).toBe(null)
    })

    it('updates fields and bumps updatedAt', () => {
      const c = createCollection({ name: 'Old' })
      const updated = updateCollection(c.id, { name: 'New', emoji: '⭐' })
      expect(updated.name).toBe('New')
      expect(updated.emoji).toBe('⭐')
      expect(updated.updatedAt).toBeGreaterThanOrEqual(c.updatedAt)
    })
  })

  describe('deleteCollection', () => {
    it('returns false for unknown id', () => {
      expect(deleteCollection('nope')).toBe(false)
    })

    it('removes the collection', () => {
      const c = createCollection({ name: 'Pubs' })
      expect(deleteCollection(c.id)).toBe(true)
      expect(getCollection(c.id)).toBe(null)
    })
  })

  describe('addPlaceToCollection / removePlaceFromCollection', () => {
    it('adds a place and prevents duplicates', () => {
      const c = createCollection({ name: 'Pubs' })
      expect(addPlaceToCollection(c.id, 'place-1', 'great pint')).toBe(true)
      expect(addPlaceToCollection(c.id, 'place-1', 'second add')).toBe(false)
      const after = getCollection(c.id)
      expect(after.places).toHaveLength(1)
      expect(after.places[0].placeId).toBe('place-1')
      expect(after.places[0].note).toBe('great pint')
    })

    it('returns false for unknown collection', () => {
      expect(addPlaceToCollection('nope', 'p1')).toBe(false)
      expect(removePlaceFromCollection('nope', 'p1')).toBe(false)
    })

    it('removes a place', () => {
      const c = createCollection({ name: 'Pubs' })
      addPlaceToCollection(c.id, 'place-1')
      expect(removePlaceFromCollection(c.id, 'place-1')).toBe(true)
      expect(getCollection(c.id).places).toEqual([])
    })

    it('removing missing place returns false', () => {
      const c = createCollection({ name: 'Pubs' })
      expect(removePlaceFromCollection(c.id, 'never-added')).toBe(false)
    })
  })

  describe('getCollectionsForPlace / isPlaceInAnyCollection', () => {
    it('returns matching collections', () => {
      const a = createCollection({ name: 'Pubs' })
      const b = createCollection({ name: 'Cafes' })
      createCollection({ name: 'Unrelated' })
      addPlaceToCollection(a.id, 'place-1')
      addPlaceToCollection(b.id, 'place-1')
      const matches = getCollectionsForPlace('place-1')
      expect(matches.map(c => c.id).sort()).toEqual([a.id, b.id].sort())
    })

    it('isPlaceInAnyCollection true/false', () => {
      const c = createCollection({ name: 'Pubs' })
      addPlaceToCollection(c.id, 'place-1')
      expect(isPlaceInAnyCollection('place-1')).toBe(true)
      expect(isPlaceInAnyCollection('place-2')).toBe(false)
    })
  })

  describe('constants', () => {
    it('exposes a default emoji palette', () => {
      expect(COLLECTION_EMOJIS.length).toBeGreaterThan(0)
      for (const e of COLLECTION_EMOJIS) expect(typeof e).toBe('string')
    })

    it('has curated collections with the same shape', () => {
      for (const c of CURATED_COLLECTIONS) {
        expect(c.id).toMatch(/^curated_/)
        expect(c.isCurated).toBe(true)
        expect(Array.isArray(c.tags)).toBe(true)
      }
    })
  })
})

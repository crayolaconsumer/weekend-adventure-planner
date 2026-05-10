/**
 * Vanilla IndexedDB wrapper for the offline-pack database.
 *
 * One database, three stores:
 *   - pack_manifest: single row keyed by id=1, the active pack metadata
 *   - pack_places: place_data JSON keyed by placeId
 *   - pack_images: image blobs keyed by URL
 */

const DB_NAME = 'roam_offline'
const DB_VERSION = 1

const STORE_MANIFEST = 'pack_manifest'
const STORE_PLACES = 'pack_places'
const STORE_IMAGES = 'pack_images'

export const STORES = {
  manifest: STORE_MANIFEST,
  places: STORE_PLACES,
  images: STORE_IMAGES,
}

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available in this environment'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains(STORE_MANIFEST)) {
        db.createObjectStore(STORE_MANIFEST, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_PLACES)) {
        db.createObjectStore(STORE_PLACES, { keyPath: 'placeId' })
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: 'url' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function txPromise(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function reqPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ─── Manifest helpers ───────────────────────────────────────────

export async function readManifest() {
  const db = await openDb()
  const tx = db.transaction(STORE_MANIFEST, 'readonly')
  return reqPromise(tx.objectStore(STORE_MANIFEST).get(1))
}

export async function writeManifest(manifest) {
  const db = await openDb()
  const tx = db.transaction(STORE_MANIFEST, 'readwrite')
  tx.objectStore(STORE_MANIFEST).put({ ...manifest, id: 1 })
  return txPromise(tx)
}

export async function deleteManifest() {
  const db = await openDb()
  const tx = db.transaction(STORE_MANIFEST, 'readwrite')
  tx.objectStore(STORE_MANIFEST).delete(1)
  return txPromise(tx)
}

// ─── Place helpers ──────────────────────────────────────────────

export async function putPlace(record) {
  const db = await openDb()
  const tx = db.transaction(STORE_PLACES, 'readwrite')
  tx.objectStore(STORE_PLACES).put(record)
  return txPromise(tx)
}

export async function getPlace(placeId) {
  const db = await openDb()
  const tx = db.transaction(STORE_PLACES, 'readonly')
  return reqPromise(tx.objectStore(STORE_PLACES).get(placeId))
}

export async function getAllPlaces() {
  const db = await openDb()
  const tx = db.transaction(STORE_PLACES, 'readonly')
  return reqPromise(tx.objectStore(STORE_PLACES).getAll())
}

export async function clearPlaces() {
  const db = await openDb()
  const tx = db.transaction(STORE_PLACES, 'readwrite')
  tx.objectStore(STORE_PLACES).clear()
  return txPromise(tx)
}

// ─── Image helpers ──────────────────────────────────────────────

export async function putImage(record) {
  const db = await openDb()
  const tx = db.transaction(STORE_IMAGES, 'readwrite')
  tx.objectStore(STORE_IMAGES).put(record)
  return txPromise(tx)
}

export async function getImage(url) {
  const db = await openDb()
  const tx = db.transaction(STORE_IMAGES, 'readonly')
  return reqPromise(tx.objectStore(STORE_IMAGES).get(url))
}

export async function clearImages() {
  const db = await openDb()
  const tx = db.transaction(STORE_IMAGES, 'readwrite')
  tx.objectStore(STORE_IMAGES).clear()
  return txPromise(tx)
}

// ─── Whole-DB helpers ───────────────────────────────────────────

export async function deleteEverything() {
  const db = await openDb()
  const tx = db.transaction([STORE_MANIFEST, STORE_PLACES, STORE_IMAGES], 'readwrite')
  tx.objectStore(STORE_MANIFEST).clear()
  tx.objectStore(STORE_PLACES).clear()
  tx.objectStore(STORE_IMAGES).clear()
  return txPromise(tx)
}

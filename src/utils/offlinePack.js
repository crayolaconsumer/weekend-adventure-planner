/**
 * Top-level offline-pack API.
 *
 * State machine — see docs/superpowers/specs/2026-05-10-offline-pack-design.md §5.
 */

import * as db from './offlinePackDb.js'

// ── Constants (locked thresholds from the spec) ────────────────
const MAX_PACK_BYTES = 300 * 1024 * 1024 // 300 MB hard cap
const STALE_TIME_DAYS = 14
const STALE_DISTANCE_KM = 30
const HARD_EXPIRE_DAYS = 60
const FAR_DISTANCE_KM = 150
const FAR_IDLE_DAYS = 30

const TILE_BYTES_PER_SQKM = 320 * 1024
const PLACE_DATA_BYTES = 500 * 1024
const IMAGES_BYTES = 8 * 1024 * 1024

const OFFLINE_API_CACHE = 'roam-offline-api-v1'
const MAP_TILE_CACHE = 'roam-map-tiles-v1'
const IMAGE_CACHE = 'roam-images-v2'

// ── Geographic helpers ─────────────────────────────────────────

export function distanceKm(a, b) {
  if (!a || !b) return Infinity
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

export function radiusToBbox(coords, radiusKm) {
  const latDelta = radiusKm / 111
  const lngDelta = radiusKm / (111 * Math.cos((coords.lat * Math.PI) / 180))
  return {
    south: coords.lat - latDelta,
    north: coords.lat + latDelta,
    west: coords.lng - lngDelta,
    east: coords.lng + lngDelta,
  }
}

// ── Size estimate ──────────────────────────────────────────────

export function estimateSize(radiusKm) {
  const areaSqKm = Math.PI * radiusKm * radiusKm
  return Math.round(areaSqKm * TILE_BYTES_PER_SQKM + PLACE_DATA_BYTES + IMAGES_BYTES)
}

export const PACK_LIMIT_BYTES = MAX_PACK_BYTES

export const THRESHOLDS = {
  STALE_TIME_DAYS,
  STALE_DISTANCE_KM,
  HARD_EXPIRE_DAYS,
  FAR_DISTANCE_KM,
  FAR_IDLE_DAYS,
}

// ── Clear ──────────────────────────────────────────────────────

/**
 * Wipe the active pack: IndexedDB stores + Cache API entries.
 * Best-effort — partial failures are logged, not thrown.
 */
export async function clearPack() {
  try {
    await db.deleteEverything()
  } catch (err) {
    console.warn('[offlinePack] IDB clear failed:', err)
  }

  if (typeof caches !== 'undefined') {
    try { await caches.delete(OFFLINE_API_CACHE) } catch { /* ignore */ }
    try { await caches.delete(MAP_TILE_CACHE) } catch { /* ignore */ }
  }

  if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'pack-changed' })
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('roam-pack-cleared'))
  }
}

// ── Status ─────────────────────────────────────────────────────

/**
 * Compute the pack's current state.
 *
 * Returns: { state, manifest?, ageDays?, distanceKm?, currentLocation? }
 * State ∈ 'none' | 'downloading' | 'fresh' | 'stale-time' | 'stale-distance' | 'expired'
 */
export async function getStatus(currentLocation = null) {
  let manifest
  try {
    manifest = await db.readManifest()
  } catch {
    return { state: 'none' }
  }

  if (!manifest) return { state: 'none' }
  if (manifest.status === 'downloading') return { state: 'downloading', manifest }

  const ageMs = Date.now() - (manifest.downloadedAt || 0)
  const ageDays = ageMs / (24 * 60 * 60 * 1000)

  const center = { lat: manifest.centerLat, lng: manifest.centerLng }
  const distance = currentLocation ? distanceKm(currentLocation, center) : null

  const isHardExpired =
    ageDays > HARD_EXPIRE_DAYS ||
    (distance != null && distance > FAR_DISTANCE_KM && ageDays > FAR_IDLE_DAYS)

  if (isHardExpired) {
    return { state: 'expired', manifest, ageDays, distanceKm: distance, currentLocation }
  }

  if (ageDays > STALE_TIME_DAYS) {
    return { state: 'stale-time', manifest, ageDays, distanceKm: distance, currentLocation }
  }

  if (distance != null && distance > STALE_DISTANCE_KM) {
    return { state: 'stale-distance', manifest, ageDays, distanceKm: distance, currentLocation }
  }

  return { state: 'fresh', manifest, ageDays, distanceKm: distance, currentLocation }
}

// ── Auto-expire ────────────────────────────────────────────────

/**
 * Run on app open. If the pack is hard-expired, clear it and dispatch
 * a `roam-pack-expired` event so the UI can show a one-shot toast.
 */
export async function checkAndAutoExpire(currentLocation = null) {
  const status = await getStatus(currentLocation)
  if (status.state !== 'expired') return { expired: false }

  await clearPack()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('roam-pack-expired', {
        detail: { manifest: status.manifest, reason: 'hard-expire' },
      })
    )
  }
  return { expired: true, manifest: status.manifest }
}

// ── Download orchestration ─────────────────────────────────────

/**
 * Download a fresh pack centred on `coords`. Replaces the active pack.
 *
 * onProgress is invoked with { phase, current, total }:
 *   { phase: 'tiles' | 'deck' | 'place-details' | 'images', current, total }
 *
 * Throws if pre-flight estimate exceeds MAX_PACK_BYTES or download fails.
 */
export async function downloadPack(coords, radiusKm, onProgress = () => {}, signal = null) {
  const estimated = estimateSize(radiusKm)
  if (estimated > MAX_PACK_BYTES) {
    throw new Error(`Pack would be approx ${Math.round(estimated / 1024 / 1024)} MB — over the ${MAX_PACK_BYTES / 1024 / 1024} MB limit. Try a smaller radius.`)
  }

  const manifest = {
    id: 1,
    centerLat: coords.lat,
    centerLng: coords.lng,
    radiusKm,
    downloadedAt: 0,
    byteSize: 0,
    placeIds: [],
    imageUrls: [],
    deckBboxes: [],
    status: 'downloading',
  }
  await db.writeManifest(manifest)

  try {
    const tilesBytes = await downloadTiles(coords, radiusKm, onProgress, signal)
    const deck = await downloadDeck(coords, radiusKm, onProgress, signal)
    const detailsBytes = await downloadPlaceDetails(deck.places, onProgress, signal)
    const imagesBytes = await downloadImages(deck.imageUrls, onProgress, signal)

    const final = {
      ...manifest,
      downloadedAt: Date.now(),
      byteSize: tilesBytes + detailsBytes + imagesBytes,
      placeIds: deck.places.map(p => p.id || p.placeId),
      imageUrls: deck.imageUrls,
      deckBboxes: [radiusToBbox(coords, radiusKm)],
      status: 'ready',
    }
    await db.writeManifest(final)

    if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'pack-changed' })
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('roam-pack-ready', { detail: { manifest: final } }))
    }

    return final
  } catch (err) {
    await db.writeManifest({ ...manifest, status: 'failed' })
    throw err
  }
}

// ── Internal batches ───────────────────────────────────────────

async function downloadTiles(coords, radiusKm, onProgress, signal) {
  const { prefetchTilesForArea } = await import('./offlineTilePrefetch.js')
  let totalBytes = 0
  await prefetchTilesForArea({
    lat: coords.lat,
    lng: coords.lng,
    radiusKm,
    minZoom: 12,
    maxZoom: 16,
    onProgress: ({ current, total, byteSize }) => {
      totalBytes = byteSize ?? totalBytes
      onProgress({ phase: 'tiles', current, total })
    },
    signal,
  })
  return totalBytes
}

async function downloadDeck(coords, radiusKm, onProgress, signal) {
  onProgress({ phase: 'deck', current: 0, total: 1 })
  const bbox = radiusToBbox(coords, radiusKm)
  const query = `[out:json][timeout:20][bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];
(
  nw["tourism"];
  nw["leisure"];
  nw["amenity"~"^(restaurant|pub|cafe|bar|cinema|theatre|museum)$"];
);
out tags center;`
  const res = await fetch('/api/places/overpass/nearby', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal,
  })
  if (!res.ok) throw new Error(`Overpass fetch failed: ${res.status}`)
  const json = await res.json()

  const elements = (json?.elements || []).slice(0, 50)
  const placesForDb = []
  const imageUrls = []
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat
    const lng = el.lon ?? el.center?.lon
    if (typeof lat !== 'number' || typeof lng !== 'number') continue
    const place = {
      id: String(el.id),
      lat,
      lng,
      name: el.tags?.name || null,
      tags: el.tags || {},
    }
    placesForDb.push(place)
    if (el.tags?.image) imageUrls.push(el.tags.image)
  }

  for (const place of placesForDb) {
    await db.putPlace({
      placeId: place.id,
      placeData: place,
      source: 'discovery',
      cachedAt: Date.now(),
    })
  }

  onProgress({ phase: 'deck', current: 1, total: 1 })
  return { places: placesForDb, imageUrls }
}

async function downloadPlaceDetails(places, onProgress, signal) {
  const cache = await caches.open(OFFLINE_API_CACHE)
  let bytesAccum = 0
  let done = 0
  const total = places.length

  const concurrency = 6
  const queue = [...places]

  async function worker() {
    while (queue.length) {
      if (signal?.aborted) throw new Error('Aborted')
      const place = queue.shift()
      const wikiTag = place.tags?.wikipedia || null
      const wikidata = place.tags?.wikidata || null

      const reqs = []
      if (wikiTag) {
        reqs.push(`/api/wikipedia/summary?tag=${encodeURIComponent(wikiTag)}`)
      }
      const params = new URLSearchParams()
      if (wikiTag) params.set('wikipedia', wikiTag)
      if (wikidata) params.set('wikidata', wikidata)
      params.set('lat', String(place.lat))
      params.set('lng', String(place.lng))
      reqs.push(`/api/places/image-resolve?${params.toString()}`)

      for (const url of reqs) {
        try {
          const res = await fetch(url, { signal })
          if (!res.ok) continue
          await cache.put(url, res.clone())
          const buf = await res.clone().arrayBuffer()
          bytesAccum += buf.byteLength
        } catch {
          // best-effort batch
        }
      }

      done += 1
      onProgress({ phase: 'place-details', current: done, total })
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)
  return bytesAccum
}

async function downloadImages(urls, onProgress, signal) {
  if (!Array.isArray(urls) || urls.length === 0) {
    onProgress({ phase: 'images', current: 0, total: 0 })
    return 0
  }

  const uniq = Array.from(new Set(urls))
  const cache = await caches.open(IMAGE_CACHE)

  let bytesAccum = 0
  let done = 0
  const total = uniq.length
  const concurrency = 6
  const queue = [...uniq]

  async function worker() {
    while (queue.length) {
      if (signal?.aborted) throw new Error('Aborted')
      const url = queue.shift()
      try {
        const res = await fetch(url, { signal, mode: 'cors' })
        if (res.ok) {
          await cache.put(url, res.clone())
          const blob = await res.clone().blob()
          await db.putImage({
            url,
            blob,
            contentType: res.headers.get('content-type') || 'image/jpeg',
            size: blob.size,
            cachedAt: Date.now(),
          })
          bytesAccum += blob.size
        }
      } catch {
        // skip cors errors etc — counter still advances below
      }
      done += 1
      onProgress({ phase: 'images', current: done, total })
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)
  return bytesAccum
}

/**
 * useOfflineMaps Hook
 *
 * Manages offline map tile caching.
 * Allows prefetching tiles for a specific area and zoom levels.
 */

import { useState, useCallback } from 'react'

// Tile URL template for CartoDB (matches DiscoverMap)
const TILE_URL_TEMPLATE = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const SUBDOMAINS = ['a', 'b', 'c', 'd']

/**
 * Convert lat/lng to tile coordinates
 * @see https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
 */
function latLngToTile(lat, lng, zoom) {
  const n = Math.pow(2, zoom)
  const x = Math.floor(((lng + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  )
  return { x, y }
}

/**
 * Generate tile URLs for a bounding box at given zoom levels
 */
function generateTileUrls(bounds, minZoom, maxZoom) {
  const urls = []

  for (let zoom = minZoom; zoom <= maxZoom; zoom++) {
    const topLeft = latLngToTile(bounds.north, bounds.west, zoom)
    const bottomRight = latLngToTile(bounds.south, bounds.east, zoom)

    // Clamp to reasonable tile count per zoom level
    const maxTilesPerZoom = 50
    const xRange = Math.min(bottomRight.x - topLeft.x + 1, maxTilesPerZoom)
    const yRange = Math.min(bottomRight.y - topLeft.y + 1, maxTilesPerZoom)

    for (let x = topLeft.x; x < topLeft.x + xRange; x++) {
      for (let y = topLeft.y; y < topLeft.y + yRange; y++) {
        // Use different subdomains for parallel loading
        const subdomain = SUBDOMAINS[(x + y) % SUBDOMAINS.length]
        const url = TILE_URL_TEMPLATE
          .replace('{s}', subdomain)
          .replace('{z}', zoom)
          .replace('{x}', x)
          .replace('{y}', y)
          .replace('{r}', '')

        urls.push(url)
      }
    }
  }

  return urls
}

/**
 * Calculate bounding box from center point and radius
 */
function getBoundsFromCenter(lat, lng, radiusKm) {
  // Approximate degrees per km
  const latDelta = radiusKm / 111
  const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180))

  return {
    north: lat + latDelta,
    south: lat - latDelta,
    east: lng + lngDelta,
    west: lng - lngDelta
  }
}

export function useOfflineMaps() {
  const [isPrefetching, setIsPrefetching] = useState(false)
  const [prefetchProgress, setPrefetchProgress] = useState(0)
  const isSupported = 'serviceWorker' in navigator

  /**
   * Prefetch map tiles for an area
   * @param {Object} options - Prefetch options
   * @param {number} options.lat - Center latitude
   * @param {number} options.lng - Center longitude
   * @param {number} options.radiusKm - Radius in kilometers (default: 5)
   * @param {number} options.minZoom - Minimum zoom level (default: 12)
   * @param {number} options.maxZoom - Maximum zoom level (default: 16)
   */
  const prefetchArea = useCallback(async ({ lat, lng, radiusKm = 5, minZoom = 12, maxZoom = 16 }) => {
    if (!isSupported || !navigator.serviceWorker.controller) {
      console.warn('Service worker not available for offline maps')
      return { success: false, error: 'Service worker not available' }
    }

    setIsPrefetching(true)
    setPrefetchProgress(0)

    try {
      const bounds = getBoundsFromCenter(lat, lng, radiusKm)
      const tileUrls = generateTileUrls(bounds, minZoom, maxZoom)

      // Send tile URLs to service worker
      navigator.serviceWorker.controller.postMessage({
        type: 'PREFETCH_MAP_TILES',
        tileUrls
      })

      // Estimate completion time (rough: 50ms per tile)
      const estimatedMs = tileUrls.length * 50

      // Fake progress since we can't track SW progress easily
      const startTime = Date.now()
      const progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime
        const progress = Math.min(elapsed / estimatedMs, 0.95)
        setPrefetchProgress(progress)
      }, 100)

      // Wait for estimated completion
      await new Promise(resolve => setTimeout(resolve, estimatedMs))

      clearInterval(progressInterval)
      setPrefetchProgress(1)

      return { success: true, tilesCount: tileUrls.length }
    } catch (error) {
      console.error('Failed to prefetch map tiles:', error)
      return { success: false, error: error.message }
    } finally {
      setIsPrefetching(false)
    }
  }, [isSupported])

  /**
   * Clear all cached map tiles
   */
  const clearCache = useCallback(() => {
    if (!isSupported || !navigator.serviceWorker.controller) {
      return
    }

    navigator.serviceWorker.controller.postMessage({
      type: 'CLEAR_MAP_CACHE'
    })
  }, [isSupported])

  /**
   * Estimate storage used by map tiles (approximate)
   */
  const estimateStorageUsed = useCallback(async () => {
    if (!isSupported) return null

    try {
      const cache = await caches.open('roam-map-tiles-v1')
      const keys = await cache.keys()

      // Average tile size ~15KB
      const estimatedBytes = keys.length * 15 * 1024
      const estimatedMB = (estimatedBytes / (1024 * 1024)).toFixed(1)

      return {
        tilesCount: keys.length,
        estimatedMB
      }
    } catch {
      return null
    }
  }, [isSupported])

  return {
    isSupported,
    isPrefetching,
    prefetchProgress,
    prefetchArea,
    clearCache,
    estimateStorageUsed
  }
}

export default useOfflineMaps

/**
 * Standalone tile prefetch — split out of useOfflineMaps so non-React
 * callers (offlinePack.js) can use it without depending on the hook.
 *
 * Writes to the existing `roam-map-tiles-v1` Cache API bucket so the
 * SW's tile routing serves them.
 */

const TILE_URL_TEMPLATE = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const SUBDOMAINS = ['a', 'b', 'c', 'd']
const MAP_TILE_CACHE = 'roam-map-tiles-v1'

function latLngToTile(lat, lng, zoom) {
  const n = Math.pow(2, zoom)
  const x = Math.floor(((lng + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  )
  return { x, y }
}

function generateTileUrls(bounds, minZoom, maxZoom) {
  const urls = []
  for (let zoom = minZoom; zoom <= maxZoom; zoom++) {
    const topLeft = latLngToTile(bounds.north, bounds.west, zoom)
    const bottomRight = latLngToTile(bounds.south, bounds.east, zoom)
    const maxTilesPerZoom = 50
    const xRange = Math.min(bottomRight.x - topLeft.x + 1, maxTilesPerZoom)
    const yRange = Math.min(bottomRight.y - topLeft.y + 1, maxTilesPerZoom)
    for (let x = topLeft.x; x < topLeft.x + xRange; x++) {
      for (let y = topLeft.y; y < topLeft.y + yRange; y++) {
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

function radiusToBbox(coords, radiusKm) {
  const latDelta = radiusKm / 111
  const lngDelta = radiusKm / (111 * Math.cos((coords.lat * Math.PI) / 180))
  return {
    south: coords.lat - latDelta,
    north: coords.lat + latDelta,
    west: coords.lng - lngDelta,
    east: coords.lng + lngDelta,
  }
}

/**
 * Prefetch tiles for the area. Resolves with total byte count.
 */
export async function prefetchTilesForArea({ lat, lng, radiusKm, minZoom = 12, maxZoom = 16, onProgress = () => {}, signal = null }) {
  if (typeof caches === 'undefined') return 0
  const bbox = radiusToBbox({ lat, lng }, radiusKm)
  const urls = generateTileUrls(bbox, minZoom, maxZoom)
  const cache = await caches.open(MAP_TILE_CACHE)

  let bytes = 0
  let done = 0
  const total = urls.length
  const concurrency = 8
  const queue = [...urls]

  async function worker() {
    while (queue.length) {
      if (signal?.aborted) throw new Error('Aborted')
      const url = queue.shift()
      try {
        const existing = await cache.match(url)
        if (existing) {
          const buf = await existing.clone().arrayBuffer()
          bytes += buf.byteLength
        } else {
          const res = await fetch(url, { signal, mode: 'cors' })
          if (res.ok) {
            await cache.put(url, res.clone())
            const buf = await res.clone().arrayBuffer()
            bytes += buf.byteLength
          }
        }
      } catch {
        // skip individual failures — counter still advances below
      }
      done += 1
      onProgress({ current: done, total, byteSize: bytes })
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)
  return bytes
}

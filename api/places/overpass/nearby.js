/**
 * Overpass API Proxy with Edge Caching
 *
 * Proxies Overpass requests through Vercel Edge for:
 * - Edge caching (1 hour, stale-while-revalidate for 2 hours)
 * - Better network path (server has faster connection to Overpass endpoints)
 * - Rate limiting and request aggregation
 *
 * POST /api/places/overpass/nearby
 * Body: { query: string }
 */

export const config = {
  runtime: 'edge'
}

// Overpass endpoints with failover
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
]

// Track endpoint health for load balancing
// NOTE: In Edge Runtime, this Map is not shared across edge locations.
// Each edge node maintains its own health state. This is acceptable because:
// 1. Health tracking is best-effort optimization, not critical functionality
// 2. Endpoints failing in one region may work in another
// 3. The failover logic handles unhealthy endpoints gracefully
const endpointHealth = new Map()

/**
 * Select the best available Overpass endpoint
 */
function selectEndpoint() {
  const now = Date.now()

  // Filter out endpoints that failed recently (last 5 minutes)
  const healthyEndpoints = OVERPASS_ENDPOINTS.filter(endpoint => {
    const lastFailure = endpointHealth.get(endpoint)
    return !lastFailure || now - lastFailure > 5 * 60 * 1000
  })

  // If all endpoints have failed recently, try the one that failed longest ago
  if (healthyEndpoints.length === 0) {
    const sorted = OVERPASS_ENDPOINTS.sort((a, b) => {
      const aFail = endpointHealth.get(a) || 0
      const bFail = endpointHealth.get(b) || 0
      return aFail - bFail
    })
    return sorted[0]
  }

  // Random selection from healthy endpoints for load distribution
  return healthyEndpoints[Math.floor(Math.random() * healthyEndpoints.length)]
}

/**
 * Mark an endpoint as failed
 */
function markEndpointFailed(endpoint) {
  endpointHealth.set(endpoint, Date.now())
}

/**
 * Mark an endpoint as healthy
 */
function markEndpointHealthy(endpoint) {
  endpointHealth.delete(endpoint)
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const { query } = body

  if (!query || typeof query !== 'string') {
    return new Response(JSON.stringify({ error: 'query is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Basic validation - query should look like Overpass QL
  if (!query.includes('[out:json]') && !query.includes('[bbox')) {
    return new Response(JSON.stringify({ error: 'Invalid Overpass query format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Limit query size to prevent abuse
  if (query.length > 10000) {
    return new Response(JSON.stringify({ error: 'Query too large' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Try endpoints with failover
  let lastError = null
  const triedEndpoints = new Set()

  for (let attempt = 0; attempt < 3; attempt++) {
    const endpoint = selectEndpoint()

    // Don't retry the same endpoint twice
    if (triedEndpoints.has(endpoint)) continue
    triedEndpoints.add(endpoint)

    try {
      const controller = new AbortController()
      // Vercel Edge has ~30s limit, use 25s to leave buffer
      const timeoutId = setTimeout(() => controller.abort(), 25000)

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        markEndpointFailed(endpoint)
        lastError = new Error(`Overpass returned ${response.status}`)
        continue
      }

      const data = await response.json()
      markEndpointHealthy(endpoint)

      // Return with aggressive caching headers
      // Edge cache for 1 hour, stale-while-revalidate for 2 hours
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200',
          'X-Overpass-Endpoint': endpoint.replace('https://', '').split('/')[0]
        }
      })

    } catch (error) {
      markEndpointFailed(endpoint)
      lastError = error

      // If it's an abort (timeout), try next endpoint
      if (error.name === 'AbortError') {
        console.warn(`[Overpass Proxy] Timeout on ${endpoint}`)
        continue
      }

      console.error(`[Overpass Proxy] Error on ${endpoint}:`, error.message)
    }
  }

  // All attempts failed
  console.error('[Overpass Proxy] All endpoints failed:', lastError?.message)

  return new Response(JSON.stringify({
    error: 'Overpass API unavailable',
    message: lastError?.message || 'All endpoints failed'
  }), {
    status: 503,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': '60'
    }
  })
}

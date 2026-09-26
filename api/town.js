/**
 * Town pages — any town on Earth, rendered live.
 *
 * Web (via vercel.json rewrites):
 *   /town                  → hub: search + popular towns
 *   /town?q=leeds          → 302 /town/leeds
 *   /town/near-me          → 302 to the visitor's town (Vercel IP geolocation)
 *   /town/:slug            → server-rendered page with live places
 * App (JSON, format=json):
 *   /api/town?slug=hatfield&format=json   → { town }
 *   /api/town?near=51.9,-0.52&format=json → { town }   (device GPS)
 *   /api/town?q=Łódź&format=json          → { slug }   (search box)
 *
 * Places come from the existing Overpass proxy, invoked in-process so it
 * keeps its KV cache, mirror failover, kill-switch and per-IP rate limit
 * (keyed on the real visitor). Pages are CDN-cached for an hour.
 */

import overpassProxy from './places/overpass/nearby.js'
import { applyRateLimit, getRateLimitKey } from './lib/rateLimit.js'
import {
  slugify, isValidSlug, resolveTown, resolveNear, slugForQuery, townOverpassQuery, groupPlaces,
  renderTownPage, renderHub, distanceKm
} from './lib/towns.js'

export const config = { runtime: 'nodejs' }

// Cold town lookups hit Nominatim; bound what one IP can make us do.
// Cached pages are served by the CDN and never reach this.
const TOWN_RATE_LIMIT = { windowMs: 5 * 60 * 1000, max: 60, blockDurationMs: 10 * 60 * 1000 }
// Near-me costs up to 4 geocoder calls and can't be CDN-cached (it's personal),
// so one client gets far fewer of them than of named towns
const NEAR_RATE_LIMIT = { windowMs: 5 * 60 * 1000, max: 10, blockDurationMs: 10 * 60 * 1000 }

const PAGE_CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400'
const LONG_CACHE = 'public, s-maxage=86400, stale-while-revalidate=604800'
// Under the service worker's 30s navigation timeout (public/sw.js), so a
// returning visitor gets this page rather than the SPA fallback. One slow
// Overpass mirror (28s) can't fit; the page then renders without places,
// uncached, and the next view usually hits the proxy's KV cache.
const BUDGET_MS = 27000
const NO_PLACES = { groups: [], total: 0 }

/**
 * Run the Overpass proxy handler without an HTTP hop. Resolves { status, body };
 * resolves { status: 504 } if it doesn't answer within timeoutMs.
 */
export function callOverpassProxy(query, ip, proxy = overpassProxy, timeoutMs = BUDGET_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ status: 504, body: null }), Math.max(0, timeoutMs))
    const done = value => { clearTimeout(timer); resolve(value) }
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code) { this.statusCode = code; return this },
      json(body) { done({ status: this.statusCode, body }); return this },
      end() { done({ status: this.statusCode, body: null }); return this }
    }
    const req = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: { query },
      socket: {}
    }
    Promise.resolve(proxy(req, res)).catch(err => { clearTimeout(timer); reject(err) })
  })
}

/**
 * { grouped, ok } — ok=false means a transient failure that must not be cached
 * publicly. Zero elements counts as a failure: the proxy only returns that when
 * every mirror came back empty, which is how a degraded Overpass looks (a real
 * town always has a café or a park inside 3km).
 */
async function fetchGroupedPlaces(town, ip, proxy, deadline) {
  try {
    const { status, body } = await callOverpassProxy(townOverpassQuery(town.lat, town.lng), ip, proxy, deadline - Date.now())
    if (status === 200 && Array.isArray(body?.elements) && body.elements.length > 0) {
      return { grouped: groupPlaces(body.elements), ok: true }
    }
    console.warn(`[town] places ${town.slug}: proxy ${status}`)
  } catch (err) {
    console.warn(`[town] places ${town.slug}: ${err.message}`)
  }
  return { grouped: NO_PLACES, ok: false }
}

/**
 * The URL a town should live at. Typos and aliases collapse onto one URL
 * ("hatfeild" → hatfield), but only onto a fixed point: the target must
 * resolve to the same place AND to itself, so redirects can never loop.
 * A qualified slug that starts with the name ("hatfield-hertfordshire") stays.
 */
async function canonicalSlug(slug, town, opts) {
  const target = slugify(town.name)
  if (target === slug || slug.startsWith(`${target}-`) || !isValidSlug(target)) return slug
  try {
    const other = await resolveTown(target, opts)
    const samePlace = other && distanceKm(town, other) < 1
    return samePlace && slugify(other.name) === target ? target : slug
  } catch {
    return slug // the page itself resolved fine; don't 503 over a nicer URL
  }
}

// applyRateLimit sets per-visitor headers; they must not ride along in the shared CDN copy
function forPublicCache(res, cache) {
  if (cache.startsWith('public')) {
    for (const h of ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']) res.removeHeader?.(h)
  }
}

function sendHtml(res, status, html, cache) {
  forPublicCache(res, cache)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', cache)
  return res.status(status).send(html)
}

function redirect(res, status, location, cache = 'public, s-maxage=86400') {
  forPublicCache(res, cache)
  res.setHeader('Location', location)
  res.setHeader('Cache-Control', cache)
  return res.status(status).end()
}

export function parseNear(value) {
  const m = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(String(value || ''))
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}

export function createHandler({ proxy = overpassProxy, fetchImpl = fetch, gate } = {}) {
  const geo = { fetchImpl, gate }
  return async function handler(req, res) {
    const deadline = Date.now() + BUDGET_MS
    const { slug: rawSlug, q, near, format } = req.query || {}
    const json = format === 'json'

    if (json) {
      // Public, non-personal data; the native apps call from capacitor:// origins
      res.setHeader('Access-Control-Allow-Origin', '*')
      if (req.method === 'OPTIONS') return res.status(204).end()
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'Method not allowed' })

    if (!rawSlug && !near && q === undefined) {
      if (json) return res.status(400).json({ error: 'slug or near is required' })
      return sendHtml(res, 200, renderHub(), LONG_CACHE)
    }

    const isNear = Boolean(near) || rawSlug === 'near-me'
    const limited = applyRateLimit(req, res, TOWN_RATE_LIMIT, 'town') ||
      (isNear ? applyRateLimit(req, res, NEAR_RATE_LIMIT, 'town_near') : null)
    if (limited) {
      if (json) return res.status(429).json(limited)
      return sendHtml(res, 429, renderHub({ unavailable: true }), 'no-store')
    }

    try {
      // ── Search box on the hub / not-found page: one hop to the final URL ──
      if (q !== undefined && !rawSlug) {
        const slug = await slugForQuery(q, geo)
        const town = slug && await resolveTown(slug, geo)
        const target = town ? await canonicalSlug(slug, town, geo) : slug
        // The app's search box asks for JSON: { slug } of a real town, or 404
        if (json) return town ? res.status(200).json({ slug: target }) : res.status(404).json({ error: 'Town not found' })
        return redirect(res, 302, target ? `/town/${target}` : '/town', 'no-store')
      }

      // ── Near me: app sends GPS; web uses Vercel's IP geolocation ──
      if (isNear) {
        const point = near
          ? parseNear(near)
          : parseNear(`${req.headers['x-vercel-ip-latitude']},${req.headers['x-vercel-ip-longitude']}`)
        if (!point) {
          if (json) return res.status(400).json({ error: 'Invalid coordinates' })
          return redirect(res, 302, '/town', 'no-store')
        }
        const found = await resolveNear(point.lat, point.lng, geo)
        // Straight to the final URL, so the 302 isn't followed by a 301
        const town = found && { ...found, slug: await canonicalSlug(found.slug, found, geo) }
        console.log(`[town] near → ${town?.slug || 'none'}`)
        res.setHeader('Cache-Control', 'private, no-store')
        if (json) return town ? res.status(200).json({ town }) : res.status(404).json({ error: 'No town found here' })
        return redirect(res, 302, town ? `/town/${town.slug}` : '/town', 'private, no-store')
      }

      // ── A named town ──
      const slug = slugify(rawSlug)
      if (!isValidSlug(slug)) {
        if (json) return res.status(404).json({ error: 'Town not found' })
        return sendHtml(res, 404, renderHub({ query: String(rawSlug).slice(0, 60), notFound: true }), 'public, s-maxage=3600')
      }
      const town = await resolveTown(slug, geo)
      if (!town) {
        console.log(`[town] miss ${slug}`)
        if (json) return res.status(404).json({ error: 'Town not found' })
        return sendHtml(res, 404, renderHub({ query: slug.replace(/-/g, ' '), notFound: true }), 'public, s-maxage=3600')
      }

      const canonical = await canonicalSlug(slug, town, geo)
      if (json) {
        forPublicCache(res, LONG_CACHE)
        res.setHeader('Cache-Control', LONG_CACHE)
        return res.status(200).json({ town: { ...town, slug: canonical } })
      }
      // One hop to the final URL ("Saint-Albans" → st-albans), never a chain
      if (canonical !== rawSlug) return redirect(res, 301, `/town/${canonical}`)

      const { grouped, ok } = await fetchGroupedPlaces(town, getRateLimitKey(req), proxy, deadline)
      console.log(`[town] render ${slug} places=${grouped.total}${ok ? '' : ' (upstream failed)'}`)
      // A failed fetch reflects this moment (or this visitor's rate limit), never share it
      const cache = !ok ? 'no-store' : grouped.total > 0 ? PAGE_CACHE : 'public, s-maxage=600'
      return sendHtml(res, 200, renderTownPage(town, grouped), cache)
    } catch (err) {
      // Geocoder down, busy or timed out: say so, don't cache it
      console.error(`[town] ${near ? 'near' : rawSlug}: ${err.message}`)
      res.setHeader('Retry-After', '60')
      if (json) return res.status(503).json({ error: 'Town lookup unavailable, try again shortly' })
      return sendHtml(res, 503, renderHub({ unavailable: true }), 'no-store')
    }
  }
}

export default createHandler()

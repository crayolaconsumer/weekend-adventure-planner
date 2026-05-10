/**
 * GET /api/wikipedia/summary?tag=<wikipediaTag>
 *
 * Cached server-side proxy for the Wikipedia REST summary API. Replaces
 * direct browser → Wikipedia traffic so we get:
 *
 *   1. Single shared cache across all our users (Vercel edge cache via
 *      s-maxage = 1 day) — N users viewing the same place → 1 Wikipedia
 *      fetch per day, not N per session.
 *   2. Rate limiting per IP, so a misbehaving client can't blow our
 *      Wikipedia quota or hammer the upstream.
 *   3. Stale-while-revalidate so users always get something fast even
 *      when our edge cache is cold.
 *
 * Tag format mirrors OSM's `wikipedia` tag: "en:Ivinghoe Beacon" or
 * just "Ivinghoe Beacon" (defaults to en).
 *
 * Returns a normalised shape consumed by src/utils/placeImage.js:
 *   { thumbnail: string|null, extract: string|null, title: string,
 *     contentUrl: string|null }
 */

import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

// In-memory function-instance cache. Vercel reuses warm functions, so
// hot tags hit this before the upstream fetch even when edge cache misses.
const inMemory = new Map()
const IN_MEMORY_TTL_MS = 60 * 60 * 1000 // 1 hour

function parseTag(tag) {
  if (typeof tag !== 'string' || tag.length === 0) return null
  if (tag.includes(':')) {
    const [lang, ...rest] = tag.split(':')
    const title = rest.join(':')
    if (!title) return null
    return { lang: lang.toLowerCase(), title }
  }
  return { lang: 'en', title: tag }
}

function pickFirstUrl(...candidates) {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim()
    if (c && typeof c === 'object') {
      const fromObj = c.url || c.source || c.src
      if (typeof fromObj === 'string' && fromObj.trim().length > 0) return fromObj.trim()
    }
  }
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'wikipedia:summary')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const tag = req.query.tag
  if (!tag || typeof tag !== 'string') {
    return res.status(400).json({ error: 'tag query param required' })
  }

  // Reject absurdly long tags before doing any real work
  if (tag.length > 200) {
    return res.status(400).json({ error: 'tag too long' })
  }

  const parsed = parseTag(tag)
  if (!parsed) {
    return res.status(400).json({ error: 'invalid tag format' })
  }

  // Function-instance cache lookup
  const memHit = inMemory.get(tag)
  if (memHit && Date.now() - memHit.ts < IN_MEMORY_TTL_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
    res.setHeader('X-Roam-Cache', 'function')
    return res.status(200).json(memHit.value)
  }

  const url = `https://${parsed.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(parsed.title)}`
  try {
    // Wikipedia's REST API requires a User-Agent identifying us per their
    // policy. Be polite — gives them a path to contact us before any rate
    // limiting on their side.
    const upstream = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'ROAM/1.0 (https://go-roam.uk; support@extrastaff.com)',
        'Accept': 'application/json'
      }
    })

    if (upstream.status === 404) {
      const value = { thumbnail: null, extract: null, title: parsed.title, contentUrl: null }
      inMemory.set(tag, { value, ts: Date.now() })
      // Cache 'not found' for an hour — wiki entries rarely appear out of nowhere
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
      return res.status(200).json(value)
    }

    if (!upstream.ok) {
      // Don't cache transient upstream failures
      res.setHeader('Cache-Control', 'no-store')
      return res.status(502).json({ error: 'upstream_failed', status: upstream.status })
    }

    const data = await upstream.json()
    const value = {
      thumbnail: pickFirstUrl(data.thumbnail, data.originalimage),
      extract: typeof data.extract === 'string' ? data.extract : null,
      title: typeof data.title === 'string' ? data.title : parsed.title,
      contentUrl: data.content_urls?.desktop?.page || null
    }

    inMemory.set(tag, { value, ts: Date.now() })

    // Edge cache: 1 day fresh, 1 week stale-while-revalidate. So users
    // get a hit until the entry is at most 1 day old, then get a stale
    // copy while we revalidate in the background. Wikipedia content
    // changes slowly; this is comfortable.
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
    res.setHeader('X-Roam-Cache', 'edge-or-fresh')
    return res.status(200).json(value)
  } catch (err) {
    console.error('Wikipedia summary proxy error', err)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(502).json({ error: 'fetch_failed' })
  }
}

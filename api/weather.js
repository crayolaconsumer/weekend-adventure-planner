/**
 * GET /api/weather?lat=&lng= — current conditions for Discover.
 *
 * Source: MET Norway Locationforecast 2.0 (api.met.no), free and licensed for
 * commercial use (NLOD 2.0 / CC BY 4.0; credit "Data from MET Norway"). It
 * replaced direct Open-Meteo calls from the app, whose free tier excludes
 * apps with ads or subscriptions.
 *
 * MET's terms (api.met.no/doc/TermsOfService): an identifying User-Agent,
 * coordinates to at most 4 decimals, honour their cache headers, and no more
 * than 20 requests/s for the whole app. Coordinates are rounded to a 0.1°
 * grid (~10 km) and each cell is CDN-cached for 30 min, so however many users
 * a cell has, MET sees about 2 requests an hour from it.
 *
 * Response: { temperature, weatherCode, source } where weatherCode is the WMO
 * code the app's filters and descriptions already understand.
 */

import { withCors } from './lib/cors.js'
import { dropRateLimitHeaders } from './lib/rateLimit.js'

const USER_AGENT = 'ROAM/1.0 (+https://www.go-roam.uk; support@extrastaff.com)'
const GRID = 10 // 0.1° cells

// MET symbol_code (suffix _day/_night/_polartwilight dropped) -> WMO code.
// Pattern-based: MET's own list has misspellings (lightssleetshowersandthunder).
export function wmoFromSymbol(symbol) {
  const s = String(symbol || '').replace(/_(day|night|polartwilight)$/, '')
  if (!s) return null
  if (s.includes('thunder')) return 95
  if (s === 'fog') return 45
  if (s === 'clearsky') return 0
  if (s === 'fair') return 1
  if (s === 'partlycloudy') return 2
  if (s === 'cloudy') return 3
  const level = s.startsWith('heavy') ? 2 : s.startsWith('light') ? 0 : 1
  if (s.includes('snow')) return [71, 73, 75][level]
  if (s.includes('showers')) return [80, 81, 82][level] // rain or sleet showers
  if (s.includes('rain') || s.includes('sleet')) return [61, 63, 65][level]
  return null
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const lat = Number(req.query?.lat)
  const lng = Number(req.query?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: 'lat and lng required' })
  }

  // Serve the cell's canonical URL so every user in it shares one CDN entry
  const cellLat = Math.round(lat * GRID) / GRID
  const cellLng = Math.round(lng * GRID) / GRID
  if (String(cellLat) !== req.query.lat || String(cellLng) !== req.query.lng) {
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=86400')
    res.setHeader('Location', `/api/weather?lat=${cellLat}&lng=${cellLng}`)
    return res.status(307).end()
  }

  try {
    const r = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${cellLat}&lon=${cellLng}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) throw new Error(`MET ${r.status}`)
    const data = await r.json()
    // The latest step at or before now: a cached answer can be served for up to
    // ~1.5 h, and [0] is the hour the forecast was made
    const series = data?.properties?.timeseries || []
    const nowIso = new Date().toISOString()
    const now = (series.filter(t => t.time <= nowIso).at(-1) || series[0])?.data
    const temperature = now?.instant?.details?.air_temperature
    const symbol = now?.next_1_hours?.summary?.symbol_code ?? now?.next_6_hours?.summary?.symbol_code
    const weatherCode = wmoFromSymbol(symbol)
    if (!Number.isFinite(temperature) || weatherCode == null) throw new Error('MET answer missing current conditions')

    dropRateLimitHeaders(res)
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600')
    return res.status(200).json({ temperature, weatherCode, source: 'Data from MET Norway' })
  } catch (err) {
    console.warn('[weather]', err.message)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(502).json({ error: 'Weather unavailable' })
  }
}

export default withCors(handler)

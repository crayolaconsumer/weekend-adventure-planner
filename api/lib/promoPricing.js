/**
 * Flat-fee pricing for promoted ("Featured") events.
 *
 * Server-authoritative: the portal shows a quote, but the price charged is
 * ALWAYS recomputed here from the stored promotion parameters at checkout —
 * the client price is never trusted.
 *
 * Model: transparent "reach bands". The purchased radius maps to a band, each
 * band has a flat per-day rate, and price = days × rate (floored to a whole
 * pound, £10 minimum). Legible for a non-technical organiser — "Town reach,
 * 14 days, £35".
 *
 *   Local   ≤10km   £1.50/day      Town  ≤25km   £2.50/day
 *   City    ≤50km   £4.00/day      Region ≤100km £6.00/day
 *
 * Worked: Town, 14 days = 14 × £2.50 = £35.00.
 */

export const ALLOWED_RADII_KM = [5, 10, 25, 50, 100]

// Ordered by ascending maxKm — bandForRadius picks the first that fits.
export const REACH_BANDS = Object.freeze([
  { key: 'local', label: 'Local', maxKm: 10, dayPence: 150 },
  { key: 'town', label: 'Town', maxKm: 25, dayPence: 250 },
  { key: 'city', label: 'City', maxKm: 50, dayPence: 400 },
  { key: 'region', label: 'Region', maxKm: 100, dayPence: 600 }
])

export const PROMO_PRICING = Object.freeze({
  minPricePence: 1000, // £10 floor — keeps the payment spam-gate while staying inviting
  pushBoostPence: 1500, // one-off "notify nearby phones" add-on (£15)
  maxDays: 90,
  currency: 'GBP'
})

// One-click presets (just pre-fill the dials — same engine underneath).
export const PROMO_PRESETS = Object.freeze([
  { key: 'taster', label: 'Taster', radiusKm: 10, days: 7, blurb: 'Local reach, one week' },
  { key: 'standard', label: 'Standard', radiusKm: 25, days: 14, blurb: 'Town reach, two weeks', recommended: true },
  { key: 'bignight', label: 'Big night', radiusKm: 50, days: 30, blurb: 'City reach, one month' }
])

/** Snap an arbitrary radius to the nearest allowed option. */
export function clampRadiusKm(km) {
  const n = Number(km)
  if (!Number.isFinite(n)) return ALLOWED_RADII_KM[0]
  let best = ALLOWED_RADII_KM[0]
  let bestDiff = Infinity
  for (const r of ALLOWED_RADII_KM) {
    const d = Math.abs(r - n)
    if (d < bestDiff) { bestDiff = d; best = r }
  }
  return best
}

/** The reach band a (clamped) radius falls into. */
export function bandForRadius(km) {
  const radius = clampRadiusKm(km)
  return REACH_BANDS.find(b => radius <= b.maxKm) || REACH_BANDS[REACH_BANDS.length - 1]
}

/**
 * Inclusive day count between two YYYY-MM-DD dates (or Date objects).
 * Returns null if either date is invalid or the range is reversed.
 */
export function promoDays(startOn, endOn) {
  const start = toUtcDate(startOn)
  const end = toUtcDate(endOn)
  if (!start || !end) return null
  const ms = end - start
  if (ms < 0) return null
  return Math.floor(ms / 86400000) + 1 // inclusive
}

/**
 * Produce a price quote for a promotion.
 * @returns {{ valid: boolean, message?: string, days?: number, radiusKm?: number,
 *             band?: object, pricePence?: number, currency?: string, breakdown?: object }}
 */
export function quotePromotion({ radiusKm, startOn, endOn, pushBoost = false }) {
  const days = promoDays(startOn, endOn)
  if (days == null) {
    return { valid: false, message: 'Invalid promotion dates' }
  }
  if (days > PROMO_PRICING.maxDays) {
    return { valid: false, message: `A campaign can run at most ${PROMO_PRICING.maxDays} days` }
  }
  const radius = clampRadiusKm(radiusKm)
  const band = bandForRadius(radius)

  const raw = days * band.dayPence
  const flooredToPound = Math.floor(raw / 100) * 100
  const basePence = Math.max(PROMO_PRICING.minPricePence, flooredToPound)
  const boost = pushBoost ? PROMO_PRICING.pushBoostPence : 0

  return {
    valid: true,
    days,
    radiusKm: radius,
    band: { key: band.key, label: band.label, maxKm: band.maxKm, dayPence: band.dayPence },
    pushBoost: !!pushBoost,
    pushBoostPence: boost,
    basePence,
    pricePence: basePence + boost,   // total charged
    currency: PROMO_PRICING.currency,
    breakdown: { dayPence: band.dayPence, days, basePence, pushBoostPence: boost }
  }
}

function toUtcDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
  }
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (!m) return null
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

export default {
  ALLOWED_RADII_KM, REACH_BANDS, PROMO_PRICING, PROMO_PRESETS,
  clampRadiusKm, bandForRadius, promoDays, quotePromotion
}

/**
 * Flat-fee pricing for promoted ("Featured") events.
 *
 * Server-authoritative: the portal shows a quote, but the price charged is
 * ALWAYS recomputed here from the stored promotion parameters at checkout —
 * the client price is never trusted.
 *
 * Formula:  price = baseFee + days*perDay + days*radiusKm*perKmPerDay
 *   days   = inclusive nights of the promo window (promo_starts_on..promo_ends_on)
 *   radius = snapped to an allowed option
 * Worked example: 14 days @ 25km = 200 + 14*150 + 14*25*3 = 3350p = £33.50
 */

export const ALLOWED_RADII_KM = [5, 10, 25, 50, 100]

export const PROMO_PRICING = Object.freeze({
  baseFeePence: 200,        // £2.00 flat base
  perDayPence: 150,         // £1.50 / day
  perKmPerDayPence: 3,      // £0.03 / km / day
  minPricePence: 300,       // never charge less than £3.00
  maxDays: 90,              // a single campaign caps at 90 days
  currency: 'GBP'
})

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
 *             pricePence?: number, currency?: string, breakdown?: object }}
 */
export function quotePromotion({ radiusKm, startOn, endOn }) {
  const days = promoDays(startOn, endOn)
  if (days == null) {
    return { valid: false, message: 'Invalid promotion dates' }
  }
  if (days > PROMO_PRICING.maxDays) {
    return { valid: false, message: `A campaign can run at most ${PROMO_PRICING.maxDays} days` }
  }
  const radius = clampRadiusKm(radiusKm)

  const base = PROMO_PRICING.baseFeePence
  const time = days * PROMO_PRICING.perDayPence
  const reach = days * radius * PROMO_PRICING.perKmPerDayPence
  const raw = base + time + reach
  const pricePence = Math.max(PROMO_PRICING.minPricePence, Math.ceil(raw))

  return {
    valid: true,
    days,
    radiusKm: radius,
    pricePence,
    currency: PROMO_PRICING.currency,
    breakdown: { baseFeePence: base, timePence: time, reachPence: reach }
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

export default { ALLOWED_RADII_KM, PROMO_PRICING, clampRadiusKm, promoDays, quotePromotion }

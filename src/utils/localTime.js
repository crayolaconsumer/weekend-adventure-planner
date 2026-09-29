/**
 * Destination-local time, coarse.
 *
 * "Now" logic about a place (off-peak, open-now) must run on the clock
 * of where the place is, not where the phone is. A full IANA lookup is
 * overkill for a multi-hour peak window: the UTC offset is roughly one
 * hour per 15 degrees of longitude, plus +1 for DST in season.
 *
 * ponytail: coarse offset is off by up to an hour at zone edges (the
 * 75-minute zones and DST start/end weeks). Fine for a veto over a
 * 3-6 hour window. Upgrade path: bundled IANA lookup if off-peak becomes
 * a core promise.
 */
export function localTimeAt(lat, lng, now = new Date()) {
  const offsetHours = Math.round(lng / 15) + (hasDst(lat, lng, now) ? 1 : 0)
  const local = new Date(now.getTime() + offsetHours * 3600000)
  return { hour: local.getUTCHours(), day: local.getUTCDay() }
}

// DST seasons: northern hemisphere (US/Canada/UK/EU) roughly
// April-October, southern hemisphere (AU/NZ/southern South America)
// roughly September-March. The longitude gates keep the rule from
// firing on ocean points and most of Asia (no DST).
function hasDst(lat, lng, now) {
  const m = now.getUTCMonth()
  if (lat >= 24 && lat <= 72) {
    if (lng >= -170 && lng <= 2 && m >= 3 && m <= 9) return true // US / Canada / UK
    if (lng >= -10 && lng <= 60 && m >= 2 && m <= 9) return true // EU
  }
  if (lat <= -10 && lat >= -45 &&
      ((lng >= 60 && lng <= 180) || (lng <= -35 && lng >= -80)) &&
      (m >= 8 || m <= 2)) return true // AU / NZ / southern South America
  return false
}

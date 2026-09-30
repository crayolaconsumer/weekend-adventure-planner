/**
 * Live-location walk eval.
 *
 *   npx vitest run -c vitest.eval.config.js tests/evals/locationWalk.eval.js
 *
 * The "x metres away" labels must track the user as they walk, but the place
 * deck must NOT re-fetch on every step. This eval simulates a whole walk
 * (GPS jitter + one real move) through the REAL pipeline —
 * shouldApplyFix (jitter filter) -> nextFetchCenter (re-center) -> enhancePlace
 * (distance) — and asserts the invariants that make the fix correct:
 *
 *   1. jitter: sub-threshold fixes do NOT apply (live location stays put)
 *   2. move: a real move DOES apply (live location updates)
 *   3. deck: the fetch center re-centers exactly ONCE (on the real move),
 *      never on jitter — so a walk costs one re-fetch, not one per step
 *   4. distance: enhancePlace tracks the live location (distance shrinks as
 *      the walk moves toward the place)
 *
 * Results: /tmp/roam-location-walk/eval-results.json
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shouldApplyFix, nextFetchCenter } from '../../src/utils/locationCenter'
import { enhancePlace } from '../../src/utils/placeFilter.js'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'tmp', 'roam-location-walk')
beforeAll(() => { mkdirSync(DIR, { recursive: true }) })

// A walk around Harpenden: a start fix, a few jitter fixes (all within ~6 m),
// then one real move ~510 m north toward a place. Fixes are modelled the way
// the plugin delivers them: pos.coords with .latitude/.longitude (that is
// exactly what the watch callback hands to shouldApplyFix).
const START = { lat: 51.6234, lng: -0.6284 }
const FIXES = [
  { coords: { latitude: 51.62345, longitude: -0.6284 } },  // ~5 m north
  { coords: { latitude: 51.62341, longitude: -0.62841 } }, // ~1 m, off-axis
  { coords: { latitude: 51.62346, longitude: -0.62839 } }, // ~6 m
  { coords: { latitude: 51.6280, longitude: -0.6284 } },   // ~510 m north (a real move)
]
const MOVE = { lat: 51.6280, lng: -0.6284 }
const PLACE = { id: 'p', name: 'The Place', type: 'park', lat: 51.6284, lng: -0.6284 }

const MOVE_THRESHOLD_M = 100  // live-location apply threshold
const RECENTER_M = 500         // deck re-center threshold

function simulateWalk() {
  let live = START          // the initial fix is set directly, not via the watch
  let fetchCenter = START
  let applied = 1            // count of applied live fixes (initial + any from the watch)
  let refetches = 0

  for (const fix of FIXES) {
    // Mirrors the hook: shouldApplyFix gets pos.coords; on apply, location
    // becomes { lat: coords.latitude, lng: coords.longitude }.
    if (shouldApplyFix(live, fix.coords, MOVE_THRESHOLD_M)) {
      live = { lat: fix.coords.latitude, lng: fix.coords.longitude }
      applied++
    }
    const next = nextFetchCenter(fetchCenter, live, RECENTER_M)
    if (next !== fetchCenter) { refetches++; fetchCenter = next }
  }

  return { live, fetchCenter, applied, refetches }
}

describe('live-location walk', () => {
  it('tracks a whole walk: jitter filtered, one real move applied, one re-fetch', () => {
    const r = simulateWalk()
    const distStart = enhancePlace(PLACE, START).distance
    const distEnd = enhancePlace(PLACE, r.live).distance

    const result = {
      live: r.live,
      fetchCenter: r.fetchCenter,
      appliedFixes: r.applied,
      refetches: r.refetches,
      distanceStartKm: distStart,
      distanceEndKm: distEnd,
    }
    console.log(JSON.stringify(result))
    writeFileSync(join(DIR, 'eval-results.json'), JSON.stringify(result, null, 2))

    // 1. jitter did not move the live location (it's not at any jitter fix)
    for (const fix of FIXES.slice(0, 3)) {
      expect(r.live).not.toEqual({ lat: fix.coords.latitude, lng: fix.coords.longitude })
    }
    // 2. the real move WAS applied
    expect(r.live).toEqual(MOVE)
    // 3. exactly ONE re-fetch for the whole walk (jitter never re-centered)
    expect(r.refetches).toBe(1)
    expect(r.applied).toBe(2) // initial fix + the one real move
    // 4. the fetch center ended at the real move
    expect(r.fetchCenter).toEqual(MOVE)
    // 5. distance shrank as the walk moved toward the place (live tracking)
    expect(distEnd).toBeLessThan(distStart)
  })
})

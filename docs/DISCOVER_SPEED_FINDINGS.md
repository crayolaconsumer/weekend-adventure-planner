# Discover Speed Findings

## Deferred

1. **Overpass KV keys are still location-exact.** The query hash includes the exact bbox produced from the user's lat/lng. The new cron warms known city-center queries, and the client uses the same shared builder, but a user a few streets away can still produce a distinct bbox and miss KV. A bigger win would be snapping Overpass query centers to a radius-aware grid before building the bbox. That needs product review because it slightly changes edge-of-radius coverage.

2. **Large-radius outer tiles are not prewarmed.** Day Trip and Explorer first paint uses a 35km center tile, then streams four outer 35km tiles. The cron warms the first-paint center tile for those modes. Warming outer samples too would improve map/list completion, but would raise the nightly job from 100 to up to 260 queries.

3. **OpenTripMap and app API calls are not part of the prewarm.** The cold path still includes OTM for <=50km radii. It is independent from Overpass and fails soft, so I left it alone. If OTM remains useful, add server-side KV prewarm for the exact `/api/places/opentripmap/nearby` URL buckets.

4. **Discover chunk is still 74.31 kB minified / 22.00 kB gzip.** The obvious heavyweight map/list views are already lazy. The next candidate is moving modal-heavy flows out of the first Discover chunk, but that touches user interactions and should be done with visual regression checks.

5. **Weather cache is memory-only.** Weather no longer blocks first cards, so persistent weather cache is lower priority. Persisting the 0.01 degree weather bucket to localStorage would remove a small app-restart fetch.

## Notes

- `src/utils/geoCache.js` already persists place results to localStorage with 10 minute fresh / 30 minute stale windows.
- `useSponsoredPlaces` is not on the critical path; it runs independently and silently fails.
- The deterministic smart-sort/diversity weave is roughly linear plus small sorts by category/zone. I did not find an obvious O(n^2) hot path in normal result sizes.

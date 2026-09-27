// Run cb once the browser is idle. Safari (all iOS) has no
// requestIdleCallback, so it gets a fixed 2s delay rather than none.
export function whenIdle(cb) {
  if (typeof requestIdleCallback === 'function') return requestIdleCallback(cb, { timeout: 3000 })
  return setTimeout(cb, 2000)
}

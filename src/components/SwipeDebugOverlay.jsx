/**
 * SwipeDebugOverlay
 *
 * Temporary debug HUD for diagnosing the iOS swipe transform bug.
 * Activated when URL has ?debug=1 (or ?debug=swipe). Renders a small
 * panel pinned top-right showing live values:
 *   - Current x / y motion values
 *   - The computed `rotate` value
 *   - The card element's INLINE style.transform (what FM/our code wrote)
 *   - The card element's COMPUTED transform (what the browser actually
 *     applies — diverges from inline when the compositor drops a write)
 *   - rAF subscriber tick count (proves whether our rAF callback is
 *     firing at all on the device)
 *   - prefers-reduced-motion media query state
 *
 * Existence is itself the diagnostic: if user can see this panel update
 * during a drag, motion values are firing. If `inline` shows a 3D
 * translate but `computed` shows the matrix at identity, iOS is
 * dropping the transform.
 */

import { useEffect, useState } from 'react'

export default function SwipeDebugOverlay({ x, y, rotate }) {
  const [tick, setTick] = useState(0)
  const [snap, setSnap] = useState({
    xv: 0, yv: 0, rv: 0,
    inline: '',
    computed: '',
    reduce: false,
  })

  useEffect(() => {
    let rafId = 0
    let count = 0
    const loop = () => {
      count += 1
      const card = document.querySelector('.swipe-card')
      const cs = card ? getComputedStyle(card) : null
      setTick(count)
      setSnap({
        xv: x.get(),
        yv: y.get(),
        rv: rotate.get(),
        inline: card?.style?.transform || '(none)',
        computed: cs?.transform || '(none)',
        reduce: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      })
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [x, y, rotate])

  return (
    <div
      style={{
        position: 'fixed',
        top: 8,
        right: 8,
        zIndex: 99999,
        background: 'rgba(0, 0, 0, 0.85)',
        color: '#0f0',
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 10,
        lineHeight: 1.35,
        padding: '6px 8px',
        borderRadius: 6,
        maxWidth: 220,
        pointerEvents: 'none',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      <div style={{ color: '#ff0', fontWeight: 700 }}>SWIPE DEBUG</div>
      <div>rAF tick #{tick}</div>
      <div>x={snap.xv.toFixed(1)} y={snap.yv.toFixed(1)} r={snap.rv.toFixed(2)}</div>
      <div>reduce-motion: {String(snap.reduce)}</div>
      <div style={{ color: '#9cf', marginTop: 4 }}>inline:</div>
      <div>{snap.inline}</div>
      <div style={{ color: '#9cf', marginTop: 4 }}>computed:</div>
      <div>{snap.computed.slice(0, 100)}</div>
    </div>
  )
}

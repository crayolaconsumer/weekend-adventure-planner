import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { motion, useMotionValue, animate, useReducedMotion } from 'framer-motion'
import { tap as hapticTap } from '../../utils/haptics'
import './DistanceBandSlider.css'

/**
 * Three-position snap slider for the distance band filter.
 *
 * Travel mode answers HOW; this slider answers HOW FAR within that
 * mode. Drag the thumb or tap a label — both snap to the nearest of
 * three positions (short / medium / long) and fire onChange with the
 * band key. Labels are passed in as props so the same component
 * relabels itself when the user switches travel mode.
 *
 * Design notes:
 *   - Drag uses a MotionValue + animate() so the thumb stays under the
 *     finger while dragging and springs to its snap target on release.
 *   - On controlled `value` changes (taps, mode switches), the thumb
 *     animates from its current position to the new target with the
 *     same spring, so taps feel as smooth as drags.
 *   - Spring tuned for "decisive but soft" — stiff enough to settle
 *     fast, damped enough to avoid overshoot wiggle.
 *   - Track width is measured once on mount + on ResizeObserver fires,
 *     so the thumb position recomputes if the user rotates their
 *     phone or the filter sheet width changes.
 */

const SPRING = { type: 'spring', stiffness: 420, damping: 32, mass: 0.6 }

export default function DistanceBandSlider({
  bands,
  value,
  onChange,
  disabled = false,
  ariaLabel = 'Distance band',
}) {
  const trackRef = useRef(null)
  const [trackWidth, setTrackWidth] = useState(0)
  const thumbX = useMotionValue(0)
  const isDraggingRef = useRef(false)
  const shouldReduceMotion = useReducedMotion()

  const activeIdx = Math.max(0, bands.findIndex(b => b.key === value))

  // Measure track width so we can convert band index → pixel offset
  // for the thumb. useLayoutEffect avoids a one-frame flash where the
  // thumb sits at x=0 before the first measurement lands.
  useLayoutEffect(() => {
    const el = trackRef.current
    if (!el) return
    const update = () => setTrackWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Pixel position for a given band index. The thumb is centred over
  // each label, so position 0 = leftmost centre, position N-1 =
  // rightmost centre. With N=3 labels spread across the track that's
  // (idx / (N-1)) * trackWidth.
  const positionForIdx = useCallback((idx) => {
    if (trackWidth === 0 || bands.length <= 1) return 0
    return (idx / (bands.length - 1)) * trackWidth
  }, [trackWidth, bands.length])

  // Spring the thumb to the active position whenever value or layout
  // changes. Skipped while a drag is in progress so we don't fight
  // the user's finger.
  useEffect(() => {
    if (isDraggingRef.current) return
    const target = positionForIdx(activeIdx)
    if (shouldReduceMotion) {
      thumbX.set(target)
      return
    }
    const controls = animate(thumbX, target, SPRING)
    return () => controls.stop()
  }, [activeIdx, positionForIdx, shouldReduceMotion, thumbX])

  const setBandByIdx = useCallback((idx) => {
    const clamped = Math.max(0, Math.min(bands.length - 1, idx))
    const next = bands[clamped]
    if (next && next.key !== value) {
      hapticTap('light')
      onChange?.(next.key)
    }
  }, [bands, value, onChange])

  const handleLabelClick = useCallback((idx) => {
    if (disabled) return
    setBandByIdx(idx)
  }, [disabled, setBandByIdx])

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false
    if (trackWidth === 0 || bands.length <= 1) return
    const current = thumbX.get()
    const slotWidth = trackWidth / (bands.length - 1)
    const idx = Math.round(current / slotWidth)
    setBandByIdx(idx)
    // If we landed on the same band we already had, the useEffect
    // won't run (idx didn't change), so spring back to the snap point
    // manually so the user doesn't end the gesture with the thumb
    // mid-track.
    const snapTarget = positionForIdx(Math.max(0, Math.min(bands.length - 1, idx)))
    if (shouldReduceMotion) {
      thumbX.set(snapTarget)
      return
    }
    animate(thumbX, snapTarget, SPRING)
  }, [thumbX, trackWidth, bands.length, setBandByIdx, positionForIdx, shouldReduceMotion])

  const handleKeyDown = useCallback((e) => {
    if (disabled) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      setBandByIdx(activeIdx - 1)
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      setBandByIdx(activeIdx + 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setBandByIdx(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setBandByIdx(bands.length - 1)
    }
  }, [disabled, activeIdx, setBandByIdx, bands.length])

  const activeBand = bands[activeIdx]

  return (
    <div
      className={`band-slider ${disabled ? 'band-slider--disabled' : ''}`}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={bands.length - 1}
      aria-valuenow={activeIdx}
      aria-valuetext={activeBand?.label}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={handleKeyDown}
    >
      <div className="band-slider-track" ref={trackRef}>
        <div className="band-slider-track-fill" />
        {bands.map((band, i) => {
          const isActive = i === activeIdx
          return (
            <button
              key={band.key}
              type="button"
              className={`band-slider-stop ${isActive ? 'band-slider-stop--active' : ''}`}
              style={{ left: bands.length > 1 ? `${(i / (bands.length - 1)) * 100}%` : '50%' }}
              onClick={() => handleLabelClick(i)}
              disabled={disabled}
              tabIndex={-1}
              aria-hidden="true"
            >
              <span className="band-slider-stop-dot" />
            </button>
          )
        })}
        <motion.div
          className="band-slider-thumb"
          style={{ x: thumbX }}
          drag={disabled ? false : 'x'}
          dragConstraints={trackRef}
          dragElastic={0.05}
          dragMomentum={false}
          onDragStart={() => { isDraggingRef.current = true }}
          onDragEnd={handleDragEnd}
          whileTap={disabled ? {} : { scale: 1.08 }}
          aria-hidden="true"
        />
      </div>
      <div className="band-slider-labels">
        {bands.map((band, i) => {
          const isActive = i === activeIdx
          return (
            <button
              key={band.key}
              type="button"
              className={`band-slider-label ${isActive ? 'band-slider-label--active' : ''}`}
              onClick={() => handleLabelClick(i)}
              disabled={disabled}
              tabIndex={-1}
              aria-hidden="true"
            >
              {band.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

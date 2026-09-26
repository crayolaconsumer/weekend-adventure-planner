import { useEffect, useRef, useState } from 'react'
import { motion, useMotionValue, useTransform, animate, useReducedMotion } from 'framer-motion'
import { useDrag } from '@use-gesture/react'
import { track } from '../utils/analytics'
import { getPlatform } from '../utils/nativeBridge'
import { tap as hapticTap } from '../utils/haptics'
import {
  getAdSenseClientId, ADSENSE_SLOT_CARD, ADSENSE_CARD_LAYOUT_KEY, injectAdSenseScript, pushAdSlot,
} from '../utils/adSense'
import { showNativeAd, hideNativeAd, destroyNativeAd, onNativeAdDismissed, setAdCardActive } from '../utils/nativeAd'
import './AdCard.css'

const XIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

// Points checked for occlusion sit this far inside the card, clear of
// the rounded corners (radius 24).
const CORNER_INSET = 28
// Web: an ad requested on top that has not filled by then collapses
const WEB_FILL_TIMEOUT_MS = 1200
// Label AdSense allows on web ('Advertisements' or 'Sponsored links')
const WEB_LABEL = 'Sponsored links'
const GRID = 5

const intersects = (a, b) => a.width > 0 && a.height > 0 &&
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

// Native: true when every point of a 5x5 grid (from the inset corners,
// evenly spaced) hits the placeholder and no toast overlaps the card.
// Toasts sit in a pointer-events: none container, which elementFromPoint
// looks straight through, so they are checked by rect.
function unobscured(el) {
  const r = el.getBoundingClientRect()
  if (document.hidden || r.width === 0) return false
  const toasts = document.querySelectorAll('.toast-container > *')
  if ([...toasts].some(t => intersects(t.getBoundingClientRect(), r))) return false
  const steps = [...Array(GRID).keys()].map(i => i / (GRID - 1))
  const xs = steps.map(f => r.left + CORNER_INSET + f * (r.width - 2 * CORNER_INSET))
  const ys = steps.map(f => r.top + CORNER_INSET + f * (r.height - 2 * CORNER_INSET))
  return xs.every(px => ys.every(py => {
    const hit = document.elementFromPoint(px, py)
    return Boolean(hit && el.contains(hit))
  }))
}

const Skeleton = ({ advertiser = true, label = 'Sponsored' }) => (
  <>
    <div className="ad-card-media" />
    <div className="ad-card-body">
      <div className="ad-card-row">
        <span className="ad-card-pill">{label}</span>
        {advertiser && <span className="ad-card-skeleton ad-card-skeleton-advertiser" />}
      </div>
      <span className="ad-card-skeleton ad-card-skeleton-headline" />
      <span className="ad-card-skeleton ad-card-skeleton-headline short" />
      <span className="ad-card-skeleton ad-card-skeleton-line" />
    </div>
  </>
)

/**
 * Ad card in the swipe stack, in ROAM's own card frame.
 *
 * Native: renders a placeholder that looks exactly like the native card
 * and asks the RoamNativeAd plugin to draw the real ad over it while this
 * card is on top and nothing covers it. The native card owns the drag and
 * reports adDismissed when swiped away.
 *
 * Web: an AdSense in-feed unit inside the frame, requested only once the
 * card is on top (never loaded hidden behind another card). The branded
 * skeleton shows while it fills; no fill within 1200ms reports 'unfilled'
 * and the stack collapses it. The frame drags (either direction skips)
 * and has a Skip button; the ad iframe itself is left alone so a drag can
 * never click the ad.
 *
 * Any swipe just advances the stack: onSwipe('nope'). Fill status goes up
 * through onStatus(slot, 'filled' | 'unfilled') on web; CardStack never
 * shows an ad card that is not filled.
 */
export default function AdCard({ slot, native = false, isTop = false, onSwipe, onStatus }) {
  const cardRef = useRef(null)
  const insRef = useRef(null)
  const pushedRef = useRef(false)
  const dismissedRef = useRef(false)
  // Native: the real card has flown off; hide the placeholder under it
  // so it does not flash while the stack advances.
  const [gone, setGone] = useState(false)
  // Native: the real card sits on top; fade the placeholder out so it does
  // not show through while the real one is dragged (opacity keeps it
  // hit-testable for the occlusion check)
  const [covered, setCovered] = useState(false)
  // Web: AdSense marked the unit filled
  const [filled, setFilled] = useState(false)
  const flyTimerRef = useRef(null)
  const onSwipeRef = useRef(onSwipe)
  const platform = getPlatform()

  useEffect(() => {
    onSwipeRef.current = onSwipe
  }, [onSwipe])

  const x = useMotionValue(0)
  const rotate = useTransform(x, [-200, 200], [-15, 15])
  const opacity = useMotionValue(1)
  const reducedMotion = useReducedMotion()

  const dismiss = (direction) => {
    if (dismissedRef.current) return
    dismissedRef.current = true
    // Skipped before any ad was on screen (web: not filled yet; native: the
    // real card never shown, only the placeholder) was never an ad view:
    // no skip event and it does not count toward the interstitial cadence
    if (!shownRef.current) {
      onSwipeRef.current?.('nope', { unfilled: true })
      return
    }
    track('ad_card_skipped', { platform, direction })
    onSwipeRef.current?.('nope')
  }

  // Counted once: web when on top and filled; native once the real card
  // is actually on screen (see showNativeAd below).
  const shownRef = useRef(false)
  // Web: ms from requesting the unit to AdSense filling it (tuning data)
  const fillMsRef = useRef(null)
  const trackShown = () => {
    if (shownRef.current) return
    shownRef.current = true
    track('ad_card_shown', { platform, ...(fillMsRef.current != null ? { fillMs: fillMsRef.current } : {}) })
  }
  useEffect(() => {
    if (!native && isTop && filled) trackShown()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- trackShown reads refs only
  }, [isTop, native, filled])

  useEffect(() => () => clearTimeout(flyTimerRef.current), [])

  // Web: request the AdSense unit once on top and report its fill status.
  useEffect(() => {
    if (native || !isTop) return
    const ins = insRef.current
    if (!ins) return
    injectAdSenseScript()
    if (!pushedRef.current) {
      pushedRef.current = true
      pushAdSlot()
    }
    let done = false
    const requestedAt = performance.now()
    const waited = () => Math.round(performance.now() - requestedAt)
    const report = () => {
      const status = ins.getAttribute('data-ad-status')
      if (done || (status !== 'filled' && status !== 'unfilled')) return
      done = true
      clearTimeout(timer)
      if (status === 'filled') {
        fillMsRef.current = waited()
        setFilled(true)
        onStatus?.(slot, status)
      } else {
        onStatus?.(slot, status, { waitedMs: waited() })
      }
    }
    const timer = setTimeout(() => {
      if (done) return
      done = true
      onStatus?.(slot, 'unfilled', { waitedMs: waited() })
    }, WEB_FILL_TIMEOUT_MS)
    const observer = new MutationObserver(report)
    observer.observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] })
    report()
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [native, isTop, slot, onStatus])

  // Native: advance when the plugin says the card was swiped away.
  useEffect(() => {
    if (!native) return
    const handle = onNativeAdDismissed((e) => {
      // Native already animated it off and destroyed it.
      if (e?.slot !== slot) return
      setAdCardActive(false)
      setGone(true)
      dismiss(e.direction || 'left')
    })
    return () => { handle.then(h => h.remove()).catch(() => {}) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dismiss reads refs only
  }, [native, slot])

  // Native: keep the real ad over the placeholder while top and unobscured.
  useEffect(() => {
    if (!native || !isTop) return
    const el = cardRef.current
    if (!el) return
    let shownKey = null
    let prevKey = null
    let frame = 0
    // Just after reaching the top the swiped card is still flying off over
    // this one: poll every frame for a moment so the ad appears the instant
    // it clears, then fall back to the 300ms interval
    const fastUntil = performance.now() + 2000

    const hide = () => {
      if (shownKey) {
        hideNativeAd(slot).catch(() => {})
        setAdCardActive(false)
      }
      shownKey = null
      setCovered(false)
    }

    const tick = () => {
      const r = el.getBoundingClientRect()
      if (!unobscured(el)) {
        prevKey = null
        hide()
        if (performance.now() < fastUntil) {
          cancelAnimationFrame(frame)
          frame = requestAnimationFrame(tick)
        }
        return
      }
      const dark = document.documentElement.getAttribute('data-theme') === 'dark'
      const key = [r.left, r.top, r.width, r.height].map(Math.round).join(',') + (dark ? 'd' : 'l')
      if (key !== shownKey) {
        shownKey = key
        showNativeAd({ slot, x: r.left, y: r.top, width: r.width, height: r.height, dark })
          .then(() => {
            if (shownKey !== key) return
            setCovered(true)
            setAdCardActive(true)
            trackShown()
          })
          .catch(() => {
            shownKey = null
          })
      }
      // While the card is still settling (stack enter animation), follow it
      // every frame so the ad appears at once and lands with the card
      if (key !== prevKey) {
        prevKey = key
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(tick)
      }
    }

    // Anything added or re-classed (sheet, menu, toast) re-checks within a
    // frame instead of waiting for the next poll. Not 'style': Framer
    // writes it every animation frame; the poll covers style-only moves.
    let domFrame = 0
    const observer = new MutationObserver(() => {
      if (domFrame) return
      domFrame = requestAnimationFrame(() => {
        domFrame = 0
        tick()
      })
    })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })

    tick()
    const interval = setInterval(tick, 300)
    window.addEventListener('resize', tick)
    window.addEventListener('scroll', tick, true)
    document.addEventListener('visibilitychange', tick)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(domFrame)
      clearInterval(interval)
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', tick)
      window.removeEventListener('scroll', tick, true)
      document.removeEventListener('visibilitychange', tick)
      hide()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- trackShown reads refs only
  }, [native, isTop, slot])

  // Web drag: same forced-3D transform write as SwipeCard so iOS Safari
  // keeps the card on its compositor layer mid-drag.
  useEffect(() => {
    if (native || !isTop) return
    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (cardRef.current) {
          cardRef.current.style.transform = `translate3d(${x.get()}px, 0, 0) rotate(${reducedMotion ? 0 : rotate.get()}deg)`
        }
      })
    }
    const unsubX = x.on('change', schedule)
    const unsubR = rotate.on('change', schedule)
    return () => {
      unsubX()
      unsubR()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [native, isTop, x, rotate, reducedMotion])

  const flyOff = (direction) => {
    if (dismissedRef.current || flyTimerRef.current) return
    hapticTap('light')
    // Native placeholder Skip (real card hidden): release the held ad
    if (native) destroyNativeAd(slot).catch(() => {})
    // Reduced motion: fade out where it is instead of flying off
    if (reducedMotion) animate(opacity, 0, { duration: 0.2 })
    else animate(x, direction === 'right' ? 500 : -500, { duration: 0.3 })
    flyTimerRef.current = setTimeout(() => dismiss(direction), 200)
  }

  const bind = useDrag(
    ({ active, movement: [mx], direction: [dx], velocity: [vx] }) => {
      if (active) {
        x.set(mx)
        return
      }
      if (mx > 100 || (vx > 0.5 && dx > 0)) flyOff('right')
      else if (mx < -100 || (vx > 0.5 && dx < 0)) flyOff('left')
      else animate(x, 0, { type: 'spring', stiffness: 300, damping: 30 })
    },
    { enabled: !native && isTop, axis: 'x' }
  )

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      flyOff(e.key === 'ArrowRight' ? 'right' : 'left')
    }
  }

  const skipButton = isTop && (
    <button
      type="button"
      className="ad-card-skip"
      onPointerDownCapture={(e) => e.stopPropagation()}
      onClick={() => flyOff('left')}
      aria-label="Skip ad"
    >
      <XIcon />
    </button>
  )

  if (native) {
    return (
      <div ref={cardRef} className={`ad-card${gone ? ' ad-card-gone' : ''}${covered ? ' ad-card-covered' : ''}`} role="article" aria-label="Sponsored">
        <Skeleton />
        <div className="ad-card-bottom">{skipButton}</div>
      </div>
    )
  }

  return (
    <motion.div
      ref={cardRef}
      className="ad-card ad-card-web"
      style={{ x, rotate: reducedMotion ? 0 : rotate, opacity }}
      {...(isTop ? bind() : {})}
      onKeyDown={isTop ? handleKeyDown : undefined}
      tabIndex={isTop ? 0 : -1}
      role="article"
      aria-label={`${WEB_LABEL}. Arrow keys skip.`}
    >
      {/* Branded skeleton until AdSense fills; the unit sits underneath */}
      {!filled && (
        <div className="ad-card-filling" aria-hidden="true">
          <Skeleton advertiser={false} label={WEB_LABEL} />
        </div>
      )}
      <div className="ad-card-body">
        <div className="ad-card-row">
          <span className="ad-card-pill">{WEB_LABEL}</span>
        </div>
      </div>
      <div className="ad-card-slot">
        <ins
          ref={insRef}
          className="adsbygoogle"
          style={{ display: 'block' }}
          data-ad-format="fluid"
          data-ad-layout-key={ADSENSE_CARD_LAYOUT_KEY || undefined}
          data-ad-client={getAdSenseClientId()}
          data-ad-slot={ADSENSE_SLOT_CARD}
          data-adtest={import.meta.env.DEV ? 'on' : undefined}
        />
      </div>
      <div className="ad-card-bottom">{skipButton}</div>
    </motion.div>
  )
}

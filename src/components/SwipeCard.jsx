import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { motion, useMotionValue, useTransform, animate, useReducedMotion, AnimatePresence } from 'framer-motion'
import { useDrag } from '@use-gesture/react'
import { Link } from 'react-router-dom'
import PlaceImage from './PlaceImage'
import CategoryIcon from './icons/CategoryIcon'
import { getOpeningState } from '../utils/openingHours'
import { fetchAndCacheImage, getCachedImage, invalidateCachedImage } from '../utils/imageCache'
import { ContributionBadge } from './ContributionDisplay'
import { useFormatDistance } from '../contexts/DistanceContext'
import { tap as hapticTap, success as hapticSuccess, warn as hapticWarn } from '../utils/haptics'
import SocialProof from './SocialProof'
import PlaceBadges from './PlaceBadges'
import FriendChips from './FriendChips'
import './SwipeCard.css'

// Category-specific placeholder images
// Stock landmark photos as category fallbacks have been removed — they
// created false impressions ("Memorial near Aylesbury" rendered with the
// Taj Mahal arch). Real photos only come from place_data or, if the
// place has a wikipedia/wikidata tag, an async upgrade to a Wikipedia
// thumbnail. When we have nothing real, we render the brand-coloured
// PlaceImage placeholder instead — never a misleading photo.
//
// getPlaceholderImage returns null to signal "no real image", which the
// render path uses to switch to the <PlaceImage> placeholder.
function getPlaceholderImage() {
  return null
}

// Icons
const XIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const HeartIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M20.84,4.61a5.5,5.5,0,0,0-7.78,0L12,5.67,10.94,4.61a5.5,5.5,0,0,0-7.78,7.78l1.06,1.06L12,21.23l7.78-7.78,1.06-1.06a5.5,5.5,0,0,0,0-7.78Z"/>
  </svg>
)

const NavigationIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="3,11 22,2 13,21 11,13"/>
  </svg>
)

const ClockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12,6 12,12 16,14"/>
  </svg>
)

const MapPinIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21,10c0,7-9,13-9,13S3,17,3,10a9,9,0,0,1,18,0Z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
)

export default function SwipeCard({
  place,
  onSwipe,
  onExpand,
  isTop = false,
  style = {},
  topContribution = null,
  friendActivity = null,
  saveCapNudge = false
}) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [hasMoved, setHasMoved] = useState(false)
  const [cachedImageUrl, setCachedImageUrl] = useState(null)
  // When the resolved photo URL fails irrecoverably (broken Wikipedia
  // thumb, blocked Unsplash, etc.) we render the brand PlaceImage
  // placeholder instead of leaving a transparent <img> over the
  // container's forest-gradient background.
  const [imageFailed, setImageFailed] = useState(false)
  const cardRef = useRef(null)
  const formatDistance = useFormatDistance()

  const topTip = topContribution

  const x = useMotionValue(0)
  const y = useMotionValue(0)

  // Get the source image URL and fallback
  const category = place.category
  const enrichedImageUrl = place.photo || place.image
  const placeholderUrl = getPlaceholderImage(place.id, category?.key)
  const sourceImageUrl = enrichedImageUrl || placeholderUrl

  // Track the last loaded source to detect enrichment updates
  const lastLoadedSourceRef = useRef(null)
  const failedUrlsRef = useRef(new Set())
  // Track blob URLs for proper cleanup (avoids stale closure in useEffect cleanup)
  const blobUrlRef = useRef(null)
  // Track pending blob URL - only swap when new image is fully loaded
  const pendingBlobUrlRef = useRef(null)
  // Track which URL is currently being loaded to handle race conditions
  const loadingUrlRef = useRef(null)

  // Load and cache image
  const loadImage = useCallback(async (imageUrl) => {
    if (!imageUrl) return

    // Skip URLs that have already failed
    if (failedUrlsRef.current.has(imageUrl)) {
      return
    }

    // Track which URL we're loading to detect stale completions
    loadingUrlRef.current = imageUrl

    // DO NOT revoke previous blob URL here - wait until new image is fully loaded
    // This prevents the race condition where the old image disappears before new one is ready

    try {
      // Check cache first for instant load
      const cached = await getCachedImage(imageUrl)

      // Check if this load is still the current one (not stale)
      if (loadingUrlRef.current !== imageUrl) {
        // A newer load was started, discard this result
        return
      }

      if (cached) {
        const newBlobUrl = URL.createObjectURL(cached)
        // Store as pending - will be committed when img.onLoad fires
        pendingBlobUrlRef.current = newBlobUrl
        setCachedImageUrl(newBlobUrl)
        // Don't set imageLoaded here - let onLoad handler do it
        // This ensures the new image is actually displayed before we clean up
        lastLoadedSourceRef.current = imageUrl
        return
      }

      // Fetch and cache the image
      const objectUrl = await fetchAndCacheImage(imageUrl, place.id)

      // Check again if this load is still current
      if (loadingUrlRef.current !== imageUrl) {
        // Stale load - revoke the fetched URL if it's a blob
        if (objectUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(objectUrl)
        }
        return
      }

      // Track if it's a blob URL as pending
      if (objectUrl?.startsWith('blob:')) {
        pendingBlobUrlRef.current = objectUrl
      } else {
        pendingBlobUrlRef.current = null
      }
      setCachedImageUrl(objectUrl)
      lastLoadedSourceRef.current = imageUrl
    } catch {
      // Check if this load is still current
      if (loadingUrlRef.current !== imageUrl) {
        return
      }
      // Fall back to direct URL on error (will trigger onError if it also fails)
      pendingBlobUrlRef.current = null
      setCachedImageUrl(imageUrl)
      lastLoadedSourceRef.current = imageUrl
    }
  }, [place.id])

  // Handle successful image load - commit pending blob URL and revoke old one
  const handleImageLoad = useCallback(() => {
    // Now that the new image is displayed, we can safely revoke the old blob URL
    // and commit the pending one as the current blob URL
    if (pendingBlobUrlRef.current) {
      // Revoke the old blob URL now that new image is visible
      if (blobUrlRef.current && blobUrlRef.current !== pendingBlobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
      }
      // Commit the pending blob URL as the current one
      blobUrlRef.current = pendingBlobUrlRef.current
      pendingBlobUrlRef.current = null
    } else if (blobUrlRef.current) {
      // New image is not a blob URL, revoke the old blob URL
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
    setImageLoaded(true)
  }, [])

  // Handle image load error - fall back to brand placeholder
  const handleImageError = useCallback(() => {
    const currentSrc = cachedImageUrl || sourceImageUrl

    // Mark this URL as failed
    if (currentSrc) {
      failedUrlsRef.current.add(currentSrc)
      invalidateCachedImage(currentSrc).catch(() => {})
      console.warn(`[SwipeCard] Image failed: ${currentSrc.substring(0, 80)}...`)
    }

    // Clean up pending blob URL if it failed
    if (pendingBlobUrlRef.current) {
      URL.revokeObjectURL(pendingBlobUrlRef.current)
      pendingBlobUrlRef.current = null
    }

    // No usable URL left — switch to the brand PlaceImage placeholder
    // so we never leave a transparent <img> sitting over the forest
    // container gradient. Previously fell back to a null placeholderUrl
    // which left the img element with the failed src and rendered as
    // empty/blank on WKWebView (no broken-image icon shows on iOS).
    setImageFailed(true)
    setImageLoaded(true)
  }, [cachedImageUrl, sourceImageUrl])

  // Load image on mount and when source changes
  useEffect(() => {
    // Reset failed state on source change so an enriched image can
    // re-attempt after a previous URL failed.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional reset on source change
    setImageFailed(false)
    loadImage(sourceImageUrl)

    // Cleanup object URLs on unmount using ref (not state, to avoid stale closure)
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
      // Also cleanup any pending blob URL that never got committed
      if (pendingBlobUrlRef.current) {
        URL.revokeObjectURL(pendingBlobUrlRef.current)
        pendingBlobUrlRef.current = null
      }
    }
  }, [loadImage, sourceImageUrl])

  // Watch for enriched image updates from parent. When CardStack
  // fetches a real image and updates `place`, we re-trigger the
  // loader.
  //
  // Two-step pattern that satisfies both react-hooks rules:
  //   1. Prop-change detection in render (no ref access). If the
  //      enriched URL string changed from last render, reset
  //      setImageLoaded(false) so the new image starts in a
  //      pristine loading state. This is the React-recommended
  //      "adjust state during render" pattern.
  //   2. Side-effect (loadImage call) in useEffect, where refs are
  //      free to access. The effect dedup-guards via the refs so a
  //      repeat URL doesn't re-fetch.
  const enrichedImage = place.photo || place.image
  const [prevEnriched, setPrevEnriched] = useState(enrichedImage)
  if (enrichedImage !== prevEnriched) {
    setPrevEnriched(enrichedImage)
    if (enrichedImage) setImageLoaded(false)
  }
  useEffect(() => {
    if (!enrichedImage) return
    if (enrichedImage === lastLoadedSourceRef.current) return
    if (failedUrlsRef.current.has(enrichedImage)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadImage is the synchronise-with-external-image-cache side effect; setState inside it is intentional async data flow per React docs ("Effects let you synchronise with external systems").
    loadImage(enrichedImage)
  }, [enrichedImage, loadImage])

  // Transform values based on drag
  const rotate = useTransform(x, [-200, 200], [-15, 15])
  const likeOpacity = useTransform(x, [0, 100], [0, 1])
  const nopeOpacity = useTransform(x, [-100, 0], [1, 0])
  const goOpacity = useTransform(y, [-100, 0], [1, 0])

  // iOS Safari can demote the .swipe-card off its GPU compositor layer
  // when Framer Motion's style binding writes a 2D `translateX/rotate`
  // mid-drag — the layer dies, the browser stops repainting until the
  // touch sequence ends. Confirmed via Playwright: Framer Motion writes
  // exactly that 2D transform string. So we also write a forced-3D
  // version DIRECTLY to the DOM from a rAF callback subscribed to the
  // motion-value `change` event. Two writes hit the same property; the
  // later (rAF) wins, and crucially it's always `translate3d(...)` so
  // the compositor layer survives every frame.
  //
  // The opacity-using indicator children continue to read x/y via
  // useTransform — that path was always working on iOS, no change.
  useEffect(() => {
    if (!isTop) return
    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const node = cardRef.current
        if (!node) return
        const xv = x.get()
        const yv = y.get()
        const rv = rotate.get()
        node.style.transform = `translate3d(${xv}px, ${yv}px, 0) rotate(${rv}deg)`
      })
    }
    const unsubX = x.on('change', schedule)
    const unsubY = y.on('change', schedule)
    const unsubR = rotate.on('change', schedule)
    // Apply initial state so we don't leave the card in whatever
    // transform Framer Motion last wrote.
    schedule()
    return () => {
      unsubX()
      unsubY()
      unsubR()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [isTop, x, y, rotate])

  // Honour OS-level reduced-motion preference. When true we leave drag
  // disabled and the card stays static; users still skip/save/go via
  // the action buttons. Also doubles as a fail-safe: anyone who can't
  // get the drag animation to render reliably (older devices, certain
  // WebView versions) can flip this in Accessibility Settings and have
  // a deterministic experience.
  const reducedMotion = useReducedMotion()
  const dragEnabled = isTop && !reducedMotion

  // Drag gesture handler. We use @use-gesture/react rather than Framer
  // Motion's built-in `drag` prop: the FM drag path interacts badly
  // with the parent CardStack motion.div's animated transform on iOS
  // Safari WKWebView, causing the card itself not to translate even
  // though its motion-value subscribers (the SKIP/SAVE/GO opacity
  // indicators) update correctly. @use-gesture writes to our motion
  // values via x.set() which iOS handles reliably.
  const bind = useDrag(
    ({ active, movement: [mx, my], direction: [dx, dy], velocity: [vx, vy] }) => {
      setIsDragging(active)

      if (active) {
        x.set(mx)
        y.set(my)
        // Track if user has moved significantly (distinguishes tap from drag).
        if (Math.abs(mx) > 10 || Math.abs(my) > 10) {
          setHasMoved(true)
        }
      } else {
        // Reset hasMoved after gesture ends so the next tap registers
        // as an expand.
        setTimeout(() => setHasMoved(false), 50)
        const swipeThreshold = 100
        const velocityThreshold = 0.5
        // Swipe-up uses a smaller distance threshold because vertical
        // flicks on a phone naturally cover less ground than horizontal
        // swipes (thumb travel is shorter, grip mechanics restrict it).
        const swipeUpThreshold = 70

        // Pick the dominant axis FIRST, then check direction. Previously
        // the if-chain checked horizontal first, so any swipe-up with
        // even slight rightward drift triggered "Save" instead of "Go".
        // User reported this exact mis-fire on real iPhone.
        // Bias toward vertical with a 30% slack — natural finger paths
        // for "up" intent drift horizontally, so require my to merely
        // exceed 70% of |mx| rather than strictly dominate. Without
        // this bias, real-device swipe-up was unreliable.
        const verticalDominant = Math.abs(my) > Math.abs(mx) * 0.7

        if (verticalDominant && (my < -swipeUpThreshold || (vy > velocityThreshold && dy < 0))) {
          // Swipe up - Go now (heavy haptic — committing to an action)
          hapticSuccess()
          animate(y, -500, { duration: 0.3 })
          setTimeout(() => onSwipe?.('go'), 200)
        } else if (!verticalDominant && (mx > swipeThreshold || (vx > velocityThreshold && dx > 0))) {
          // Swipe right - Like (success haptic — saving a place)
          hapticSuccess()
          animate(x, 500, { duration: 0.3 })
          setTimeout(() => onSwipe?.('like'), 200)
        } else if (!verticalDominant && (mx < -swipeThreshold || (vx > velocityThreshold && dx < 0))) {
          // Swipe left - Nope (warn haptic — discarding)
          hapticWarn()
          animate(x, -500, { duration: 0.3 })
          setTimeout(() => onSwipe?.('nope'), 200)
        } else {
          // Spring back to origin
          animate(x, 0, { type: 'spring', stiffness: 300, damping: 30 })
          animate(y, 0, { type: 'spring', stiffness: 300, damping: 30 })
        }
      }
    },
    { enabled: dragEnabled }
  )

  const handleButtonClick = (action) => {
    // Haptic feedback — match the gesture meaning. Fire-and-forget;
    // no need to await since the user has already committed.
    if (action === 'go' || action === 'like') hapticSuccess()
    else if (action === 'nope') hapticWarn()
    else hapticTap('light')

    // 'go' must fire onSwipe SYNCHRONOUSLY — CardStack uses it to call
    // window.location.href to open Google Maps, and mobile browsers
    // block that navigation if it happens outside the user-gesture
    // tick (i.e. inside a setTimeout). Previously the setTimeout below
    // killed the navigation silently on real devices. The card still
    // animates — the user navigates away mid-animation, which is the
    // expected feel because they're now in Maps.
    if (action === 'go') {
      onSwipe?.(action)
      animate(y, -500, { duration: 0.3 })
      return
    }

    if (action === 'like') {
      animate(x, 500, { duration: 0.3 })
    } else if (action === 'nope') {
      animate(x, -500, { duration: 0.3 })
    }
    // For like/nope the setTimeout is fine — onSwipe just notifies the
    // parent and triggers the next card; no external navigation needed.
    setTimeout(() => onSwipe?.(action), 200)
  }

  // Handle tap to expand (only if not dragging)
  const handleCardClick = (e) => {
    // Don't expand if clicking on buttons
    if (e.target.closest('.swipe-card-actions')) return
    // Don't expand if the user was dragging
    if (hasMoved) return
    // Trigger expand callback
    onExpand?.(place)
  }

  // Handle keyboard navigation for accessibility
  const handleKeyDown = (e) => {
    if (!isTop) return

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault()
        handleButtonClick('nope')
        break
      case 'ArrowRight':
        e.preventDefault()
        handleButtonClick('like')
        break
      case 'ArrowUp':
        e.preventDefault()
        handleButtonClick('go')
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        onExpand?.(place)
        break
    }
  }

  // Get rich opening hours state
  const openingState = useMemo(() => {
    return getOpeningState(place.openingHours || place.opening_hours, place)
  }, [place])

  return (
    <motion.div
      ref={cardRef}
      className={`swipe-card ${isDragging ? 'dragging' : ''}`}
      style={{
        x,
        y,
        rotate,
        ...style
      }}
      {...(dragEnabled ? bind() : {})}
      onClick={isTop ? handleCardClick : undefined}
      onKeyDown={isTop ? handleKeyDown : undefined}
      tabIndex={isTop ? 0 : -1}
      role="article"
      aria-label={`${place.name}. Press Enter to view details, Arrow keys to swipe.`}
    >
      {/* Background Image */}
      <div className="swipe-card-image-container">
        {sourceImageUrl && !imageFailed ? (
          <>
            {!imageLoaded && <div className="swipe-card-image-placeholder" />}
            <img
              src={cachedImageUrl || sourceImageUrl}
              alt={place.name}
              className={`swipe-card-image ${imageLoaded ? 'loaded' : ''}`}
              onLoad={handleImageLoad}
              onError={handleImageError}
              referrerPolicy="no-referrer"
            />
          </>
        ) : (
          // No usable photo (no source, or every fetch attempt failed).
          // PlaceImage renders the brand placeholder — category icon
          // medallion over a theme-aware radial — so the card never
          // shows up as a transparent blank.
          <PlaceImage
            place={place}
            alt={place.name}
            className="swipe-card-image loaded"
          />
        )}
      </div>

      {/* Gradient Overlay */}
      <div className="swipe-card-gradient" />

      {/* Action Indicators */}
      <motion.div
        className="swipe-card-indicator like"
        style={{ opacity: likeOpacity }}
      >
        SAVE
      </motion.div>
      <motion.div
        className="swipe-card-indicator nope"
        style={{ opacity: nopeOpacity }}
      >
        SKIP
      </motion.div>
      <motion.div
        className="swipe-card-indicator go"
        style={{ opacity: goOpacity }}
      >
        GO NOW
      </motion.div>

      {/* Content overlay. Gated by isTop so back-stack cards show
          ONLY the image — no badge, no title, no tag. Previously
          all three stacked cards rendered full content, which meant
          the back card's title/badges showed through whenever the
          top card was mid-transition (fade-out during AnimatePresence
          exit). Users saw two titles, two HISTORY & HERITAGE badges,
          two "you love history & heritage" tags stacked. With this
          gate, only the actual top card has any text overlay; the
          peek-of-back-card behind it is just an image. */}
      {isTop && (
      <div className="swipe-card-content">
        {/* Friend chips - show if friends have engaged with this place */}
        {friendActivity && friendActivity.friendCount > 0 && (
          <FriendChips friendActivity={friendActivity} />
        )}

        <div className="swipe-card-badges-row">
          {category && (
            <span
              className="swipe-card-category"
              style={{ '--category-color': category.color }}
            >
              <CategoryIcon name={category.key} size="sm" />
              {category.label}
            </span>
          )}
          {/* PlaceBadges (independent / outdoor space / no-charge etc.)
             intentionally removed from the swipe card. The default emoji
             rendering reads as clutter against the card's photo + the
             clean category chip, and we don't have branded SVG variants
             for them. They still surface in the PlaceDetail modal when
             the user taps in — that's the right place for "deeper" info. */}
        </div>

        <h2 className="swipe-card-name">{place.name}</h2>

        <div className="swipe-card-meta">
          {place.distance && (
            <span className="swipe-card-meta-item">
              <MapPinIcon />
              {formatDistance(place.distance)}
            </span>
          )}
          {openingState.state !== 'unknown' && (
            <span className={`swipe-card-meta-item hours-${openingState.state}`}>
              <ClockIcon />
              {openingState.stateLabel}
              {openingState.state === 'closing_soon' && <span className="pulse-dot" />}
            </span>
          )}
          {place.type && (
            <span className="swipe-card-meta-item type">
              {place.type.replace(/_/g, ' ')}
            </span>
          )}
          <SocialProof placeId={place.id} place={place} variant="compact" />
        </div>

        {/* Show community tip if available, otherwise show description */}
        {topTip ? (
          <div className="swipe-card-tip">
            <ContributionBadge
              contribution={topTip}
              variant="compact"
              onClick={(e) => {
                e.stopPropagation()
                onExpand?.(place)
              }}
            />
          </div>
        ) : place.description ? (
          <p className="swipe-card-description">"{place.description}"</p>
        ) : null}

        {place.address && (
          <p className="swipe-card-address">{place.address}</p>
        )}
      </div>
      )}

      {/* Action Buttons.
          onPointerDownCapture stopPropagation is critical now that the
          card uses Framer Motion's drag. Without it, tapping a button
          starts a drag gesture on the parent motion.div, which on iOS
          Safari can suppress the click event entirely (and the visible
          feedback feels like "the button doesn't work"). Stopping
          propagation at capture phase keeps the buttons feeling like
          buttons, while the rest of the card stays draggable. */}
      {isTop && (
        <div className="swipe-card-actions">
          <button
            className="swipe-card-btn nope"
            onPointerDownCapture={(e) => e.stopPropagation()}
            onClick={() => handleButtonClick('nope')}
            aria-label="Skip this place"
          >
            <XIcon />
          </button>
          <button
            className="swipe-card-btn go"
            onPointerDownCapture={(e) => e.stopPropagation()}
            onClick={() => handleButtonClick('go')}
            aria-label="Go to this place now"
          >
            <NavigationIcon />
          </button>
          {/* Heart + optional save-cap bubble. The bubble is absolutely
              positioned above the heart so it never reflows the row,
              never pushes the card content out of line, and only shows
              for free users who have hit the 10-save cap. */}
          <div className="swipe-card-like-wrap">
            <AnimatePresence>
              {saveCapNudge && (
                <motion.div
                  className="swipe-card-savecap-bubble"
                  initial={{ opacity: 0, y: 8, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.9 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                >
                  <Link
                    to="/pricing"
                    className="swipe-card-savecap-link"
                    onPointerDownCapture={(e) => e.stopPropagation()}
                  >
                    Save without limits → ROAM+
                  </Link>
                  <span className="swipe-card-savecap-tail" aria-hidden="true" />
                </motion.div>
              )}
            </AnimatePresence>
            <button
              className="swipe-card-btn like"
              onPointerDownCapture={(e) => e.stopPropagation()}
              onClick={() => handleButtonClick('like')}
              aria-label="Save to wishlist"
            >
              <HeartIcon />
            </button>
          </div>
        </div>
      )}
    </motion.div>
  )
}

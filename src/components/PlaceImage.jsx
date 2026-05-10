/**
 * PlaceImage
 *
 * Single-source-of-truth image renderer for place data. Renders an
 * actual photo when one is known, asynchronously upgrades to a
 * Wikipedia thumbnail when the place has a wikipedia tag, and falls
 * back to a stylized brand-coloured placeholder when no image is
 * available — never to misleading iconic landmark photos.
 *
 * Pass either a `place` (full place object — we'll resolve the URL)
 * or a pre-resolved `src`. Optional `categoryKey` lets callers
 * style the placeholder explicitly when the place object lacks
 * structured category info.
 */

import { useEffect, useRef, useState } from 'react'
import { resolvePlaceImageSync, resolvePlaceImageAsync } from '../utils/placeImage'
import './PlaceImage.css'

function getCategoryKey(place, override) {
  if (override) return override
  const cat = place?.category ?? place?.placeData?.category
  if (typeof cat === 'string') return cat.toLowerCase()
  if (cat && typeof cat === 'object' && typeof cat.key === 'string') return cat.key
  return 'default'
}

function getCategoryIcon(place) {
  const cat = place?.category ?? place?.placeData?.category
  if (cat && typeof cat === 'object') return cat.icon || null
  return null
}

export default function PlaceImage({
  place,
  src: srcProp,
  alt = '',
  className = '',
  categoryKey: categoryKeyProp,
  rounded = false,
  imgProps = {}
}) {
  const initialSrc = srcProp ?? resolvePlaceImageSync(place)
  const [src, setSrc] = useState(initialSrc)
  const [errored, setErrored] = useState(false)
  const cancelledRef = useRef(false)

  // Async upgrade if no sync image was available. Setting state from
  // prop/place changes is the documented escape hatch for this lint
  // rule — derived initial state must be re-derived on input change.
  useEffect(() => {
    cancelledRef.current = false
    if (srcProp) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Sync prop -> state
      setSrc(srcProp)
      setErrored(false)
      return
    }
    const sync = resolvePlaceImageSync(place)
    if (sync) {
      setSrc(sync)
      setErrored(false)
      return
    }
    setSrc(null)
    setErrored(false)
    resolvePlaceImageAsync(place).then((url) => {
      if (cancelledRef.current) return
      if (url) setSrc(url)
    })
    return () => { cancelledRef.current = true }
  }, [place, srcProp])

  const categoryKey = getCategoryKey(place, categoryKeyProp)
  const icon = getCategoryIcon(place)

  if (!src || errored) {
    return (
      <div
        className={`place-image place-image--placeholder place-image--cat-${categoryKey} ${rounded ? 'place-image--rounded' : ''} ${className}`}
        role="img"
        aria-label={alt || 'Place image'}
      >
        {icon && <span className="place-image-placeholder-icon">{icon}</span>}
      </div>
    )
  }

  return (
    <img
      {...imgProps}
      src={src}
      alt={alt}
      className={`place-image ${rounded ? 'place-image--rounded' : ''} ${className}`}
      loading={imgProps.loading ?? 'lazy'}
      onError={() => setErrored(true)}
    />
  )
}

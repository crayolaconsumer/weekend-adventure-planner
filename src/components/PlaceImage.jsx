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
import { resolvePlaceImageSync, resolvePlaceImageWithMeta } from '../utils/placeImage'
import { PhotoCredit } from './Attribution'
import PlaceArt from './PlaceArt'
import './PlaceImage.css'

function getCategoryKey(place, override) {
  if (override) return override
  const cat = place?.category ?? place?.placeData?.category
  if (typeof cat === 'string') return cat.toLowerCase()
  if (cat && typeof cat === 'object' && typeof cat.key === 'string') return cat.key
  return 'default'
}

export default function PlaceImage({
  place,
  src: srcProp,
  alt = '',
  className = '',
  categoryKey: categoryKeyProp,
  rounded = false,
  imgProps = {},
  // Set on large renders (PlaceDetail hero) to show "Photo: ..." for a
  // resolved Wikipedia/Commons photo; the parent must be positioned
  creditClassName = null
}) {
  const initialSrc = srcProp ?? resolvePlaceImageSync(place)
  const [src, setSrc] = useState(initialSrc)
  const [errored, setErrored] = useState(false)
  const [attribution, setAttribution] = useState(null)
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
      setAttribution(null)
      return
    }
    const sync = resolvePlaceImageSync(place)
    if (sync) {
      setSrc(sync)
      setErrored(false)
      setAttribution(place?.imageAttribution ?? null)
      return
    }
    setSrc(null)
    setErrored(false)
    setAttribution(null)
    resolvePlaceImageWithMeta(place).then((meta) => {
      if (cancelledRef.current || !meta?.url) return
      setSrc(meta.url)
      setAttribution(meta.attribution ?? null)
    })
    return () => { cancelledRef.current = true }
  }, [place, srcProp])

  const categoryKey = getCategoryKey(place, categoryKeyProp)

  if (!src || errored) {
    return (
      <div
        className={`place-image place-image--placeholder place-image--cat-${categoryKey} ${rounded ? 'place-image--rounded' : ''} ${className}`}
        role="img"
        aria-label={alt || 'Place image'}
      >
        <PlaceArt seed={place?.id ?? place?.name ?? alt} categoryKey={categoryKey} />
      </div>
    )
  }

  const img = (
    <img
      {...imgProps}
      src={src}
      alt={alt}
      className={`place-image ${rounded ? 'place-image--rounded' : ''} ${className}`}
      loading={imgProps.loading ?? 'lazy'}
      onError={() => setErrored(true)}
      // See Avatar.jsx for the full explanation. tl;dr: Capacitor's
      // Android WebView serves from https://localhost/ and the Referer
      // header it sends to some external CDNs (Google avatars, Wikipedia
      // hot-link guard, etc) gets treated as untrusted, returning empty
      // bodies. no-referrer makes those CDNs serve the image normally.
      referrerPolicy="no-referrer"
    />
  )
  if (!creditClassName || !attribution) return img
  return (
    <>
      {img}
      <PhotoCredit attribution={attribution} className={creditClassName} />
    </>
  )
}

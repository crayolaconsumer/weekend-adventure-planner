/**
 * Licence credits: OpenStreetMap for place data (ODbL) and the photographer
 * for card/detail photos (CC BY / BY-SA need name + licence + link).
 * Map tiles credit OSM themselves (utils/mapTiles.js); this is the database.
 */
import { openExternalLink } from '../utils/navigation'

export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright'

// Links sit inside draggable cards and in the Capacitor webview, where a bare
// target=_blank dead-ends; stop the drag and open via the in-app browser.
function ExternalLink({ href, children, ...rest }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onPointerDownCapture={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        openExternalLink(href)
      }}
      {...rest}
    >
      {children}
    </a>
  )
}

export function OsmDataCredit({ className = 'osm-data-credit' }) {
  return (
    <p className={className}>
      Place data © <ExternalLink href={OSM_COPYRIGHT_URL}>OpenStreetMap contributors</ExternalLink>
    </p>
  )
}

/**
 * "Photo: {artist}, {licence}" from an image-resolve attribution
 * ({ name, url, source, artist?, license? }). Falls back to the source when
 * the artist is unknown; null when there's nothing honest to say.
 */
function photoCreditText(attr) {
  if (!attr) return null
  const who = attr.artist || attr.source
  if (!who) return null
  return `Photo: ${who}${attr.license ? `, ${attr.license}` : ''}`
}

export function PhotoCredit({ attribution, className, tabIndex }) {
  const text = photoCreditText(attribution)
  if (!text) return null
  const href = attribution.url || attribution.page_url
  return href && /^https?:\/\//i.test(href)
    ? <ExternalLink href={href} className={className} tabIndex={tabIndex}>{text}</ExternalLink>
    : <span className={className}>{text}</span>
}

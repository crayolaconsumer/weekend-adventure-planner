/**
 * Licence credits: OpenStreetMap for place data (ODbL) and the photographer
 * for card/detail photos (CC BY / BY-SA need name + licence + link).
 * Map tiles credit OSM themselves (utils/mapTiles.js); this is the database.
 */
import { openExternalLink } from '../utils/navigation'
import './Attribution.css'

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

export function OsmDataCredit({ className = '' }) {
  return (
    <p className={`osm-data-credit ${className}`.trim()}>
      Place data © <ExternalLink href={OSM_COPYRIGHT_URL}>OpenStreetMap contributors</ExternalLink>
    </p>
  )
}

/**
 * "Photo: {artist}, {licence}" from an image-resolve attribution
 * ({ name, url, source, artist?, license? }). Falls back to the source when
 * the artist is unknown; nothing when there's nothing honest to say.
 */
export function PhotoCredit({ attribution, className = '', tabIndex }) {
  const who = attribution?.artist || attribution?.source
  if (!who) return null
  const text = `Photo: ${who}${attribution.license ? `, ${attribution.license}` : ''}`
  const cls = `photo-credit ${className}`.trim()
  const href = attribution.url || attribution.page_url
  return href && /^https?:\/\//i.test(href)
    ? <ExternalLink href={href} className={cls} tabIndex={tabIndex}>{text}</ExternalLink>
    : <span className={cls}>{text}</span>
}

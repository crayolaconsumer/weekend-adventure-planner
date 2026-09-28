/**
 * Shown when the deck is short of places the user hasn't swiped yet
 * (seenPlaces.buildFreshDeck says `dry`). Says so plainly and offers the
 * next distance out, and clearing filters when any are on. Old skips only
 * come back as a last resort, and the notice says when they have.
 */
import { getBandsFor } from './distanceBands'
import { TRAVEL_MODES } from './constants'

const MODE_ORDER = ['walking', 'transit', 'driving', 'dayTrip', 'explorer']
const km = m => `${Math.round(m / 100) / 10} km`

/** The next step out from here: a further band, else a wider travel mode. */
// eslint-disable-next-line react-refresh/only-export-components
export function nextWider(travelMode, selectedBand, isPremium) {
  const bands = getBandsFor(travelMode)
  const i = bands.findIndex(b => b.key === selectedBand)
  if (i >= 0 && i < bands.length - 1) {
    const b = bands[i + 1]
    return { band: b.key, label: `Look further: ${km(b.minMeters)} to ${km(b.maxMeters)}` }
  }
  const mode = MODE_ORDER.slice(MODE_ORDER.indexOf(travelMode) + 1)
    .find(m => TRAVEL_MODES[m] && (isPremium || !TRAVEL_MODES[m].premium))
  if (!mode) return null
  return { mode, label: `Switch to ${TRAVEL_MODES[mode].label.toLowerCase()} (up to ${km(TRAVEL_MODES[mode].maxRadius)})` }
}

export default function DeckRunningDryNotice({
  freshCount, recycledCount = 0, travelMode, selectedBand, isPremium, hasFilters,
  onBandChange, onTravelModeChange, onClearFilters, compact = false,
}) {
  const wider = nextWider(travelMode, selectedBand, isPremium)
  const heading = freshCount === 0
    ? "You've swiped every place in this range"
    : `Only ${freshCount} new ${freshCount === 1 ? 'place' : 'places'} left in this range`
  const body = [
    freshCount === 0 ? 'Nothing here is new to you.' : "You've swiped the rest.",
    wider || hasFilters ? `To see new places, ${[wider && 'search further out', hasFilters && 'clear your filters'].filter(Boolean).join(' or ')}.` : '',
    recycledCount > 0
      ? `Until then, the last ${recycledCount === 1 ? 'card is a place' : `${recycledCount} cards are places`} you skipped longest ago.`
      : '',
  ].filter(Boolean).join(' ')

  return (
    // With cards still in the deck, the compact strip keeps them on screen
    <div className={`discover-closed-notice${compact ? ' compact' : ''}`} role="status" data-testid="deck-running-dry">
      {compact ? <p><strong>{heading}.</strong> {body}</p> : <><h2>{heading}</h2><p>{body}</p></>}
      {wider && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => (wider.band ? onBandChange(wider.band) : onTravelModeChange(wider.mode))}
        >
          {wider.label}
        </button>
      )}
      {hasFilters && (
        <button type="button" className="btn btn-secondary" onClick={onClearFilters}>
          Clear filters
        </button>
      )}
    </div>
  )
}

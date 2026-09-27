/**
 * Shown when filtering out places that are closed right now leaves the deck
 * thin (fewer than MIN_OPEN_CARDS), e.g. late at night. Offers to include
 * places that open later; each of those cards shows when it opens.
 */

// eslint-disable-next-line react-refresh/only-export-components
export function formatOpening(date, now = new Date()) {
  if (!date) return null
  const time = date.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(':00', '')
  const sameDay = date.toDateString() === now.toDateString()
  return sameDay ? time : `${date.toLocaleDateString('en-GB', { weekday: 'short' })} ${time}`
}

export default function ClosedNowNotice({ openCount, closedCount = 0, filtered = false, firstOpens, includeClosed, onToggle }) {
  if (includeClosed) {
    return (
      <div className="discover-closed-notice compact" role="status">
        <p>Showing places that open later. Each card says when it opens.</p>
        <button type="button" className="btn btn-secondary" aria-pressed="true" onClick={onToggle}>
          Hide closed places
        </button>
      </div>
    )
  }

  const opens = formatOpening(firstOpens)
  const where = filtered ? 'nearby matching your filters' : 'nearby'
  const heading = openCount === 0 ? `Everything ${where} is closed right now`
    : closedCount > openCount ? `Most places ${where} are closed right now`
    : `More places ${where} open later`
  return (
    <div className="discover-closed-notice" role="status">
      <h2>{heading}</h2>
      <p>
        {openCount === 0 ? 'Nothing is open at this hour.' : `${openCount} ${openCount === 1 ? 'place is' : 'places are'} open now, ${closedCount} more ${closedCount === 1 ? 'opens' : 'open'} later.`}
        {opens ? ` The first opens at ${opens}.` : ''}
      </p>
      <button type="button" className="btn btn-primary" aria-pressed="false" onClick={onToggle}>
        {opens ? `Show places that open later (from ${opens})` : 'Show places that open later'}
      </button>
    </div>
  )
}

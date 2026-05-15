/**
 * PullToRefreshIndicator — the visible affordance for pull-to-refresh.
 *
 * Pairs with the usePullToRefresh hook. Translates downward as the
 * user pulls, fills/rotates as the threshold is approached, and spins
 * while the refresh promise is in flight. Branded forest-on-cream
 * palette to match the rest of the app's iconography.
 *
 * Renders absolutely positioned at the top of its parent — the parent
 * just needs `position: relative` (or another containing block) and
 * `overflow-x: clip` so the indicator can sit offscreen at rest.
 */

import './PullToRefreshIndicator.css'

const CompassIcon = ({ rotation = 0 }) => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ transform: `rotate(${rotation}deg)`, transition: 'transform 80ms linear' }}
  >
    <circle cx="12" cy="12" r="10" />
    <path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" />
  </svg>
)

export default function PullToRefreshIndicator({
  distance = 0,
  refreshing = false,
  active = false,
  threshold = 70,
}) {
  const armed = distance >= threshold
  const progress = Math.min(distance / threshold, 1)
  // Visible when pulling OR refreshing; sits offscreen otherwise so
  // the page header isn't padded out at rest.
  const visible = active || refreshing
  // Refresh state pins the indicator just below the top safe-area
  // until the promise resolves. While pulling, distance is applied
  // directly so the indicator tracks the finger.
  const translateY = refreshing ? threshold : distance
  const rotation = armed ? 180 : progress * 180

  return (
    <div
      className={`pull-refresh-indicator ${visible ? 'visible' : ''} ${refreshing ? 'refreshing' : ''}`}
      style={{ transform: `translate3d(-50%, ${Math.max(0, translateY - 48)}px, 0)` }}
      aria-hidden={!visible}
    >
      <div className="pull-refresh-bubble">
        {refreshing ? (
          <div className="pull-refresh-spinner">
            <CompassIcon />
          </div>
        ) : (
          <CompassIcon rotation={rotation} />
        )}
      </div>
    </div>
  )
}

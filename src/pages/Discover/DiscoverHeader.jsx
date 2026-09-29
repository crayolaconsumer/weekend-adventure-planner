import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { SettingsIcon } from './icons'
import { tap as hapticTap } from '../../utils/haptics'

/**
 * Discover hero/header block: a town-name hero (the screen's identity,
 * tappable to explore the town), one quiet line (weather · travel mode ·
 * streak, tappable to open filters), the "I'm Bored" CTA + tooltip, and the
 * top-left cog with an active-filter badge.
 *
 * Pure presentational — receives the data and callbacks it needs, doesn't
 * own state. The boredom button is disabled until we have a location and
 * at least one place; the tooltip explains the disabled reason.
 *
 * The old ROAM wordmark + tagline + three-pill status row are gone: the town
 * hero carries the identity + navigation, the quiet line carries weather +
 * mode + streak, and the cog + bored pill keep their jobs.
 */
export default function DiscoverHeader({
  streak,
  activeFiltersCount,
  hasLocation,
  placesCount,
  loading,
  loadError,
  weather,
  travelMode,
  travelModeLabel,
  onOpenFilters,
  onTriggerJustGo,
  town,
}) {
  const justGoDisabled = !hasLocation || placesCount === 0
  const tooltipText = !hasLocation
    ? 'Getting your location...'
    : 'Finding places nearby...'

  return (
    <header className="discover-header">
      {/* Town hero — the identity of the screen. Tapping it explores the town
          (existing TownPage route); it is the page's h1 for screen readers. */}
      <Link
        className="discover-town-name"
        to={town ? `/town/${town.slug}` : '/town'}
        onClick={() => hapticTap('light')}
        aria-label={town ? `Explore ${town.name}` : 'Explore towns near you'}
      >
        {town ? town.name : 'Explore towns'}
      </Link>
      <span className="discover-rule" aria-hidden="true" />

      {/* One quiet line: weather · travel mode · streak. Tapping it opens
          filters — the easiest-to-reach control on the screen. */}
      <button
        className="discover-quiet"
        onClick={() => { hapticTap('light'); onOpenFilters?.() }}
        aria-label="Weather, travel mode and streak. Open filters"
      >
        {weather && <span>{Math.round(weather.temperature)}° {weather.description}</span>}
        {weather && <span className="discover-quiet-sep" aria-hidden="true">·</span>}
        <span>{travelModeLabel}</span>
        {streak > 0 && <span className="discover-quiet-sep" aria-hidden="true">·</span>}
        {streak > 0 && <span className="discover-quiet-streak">{streak}-day streak</span>}
      </button>

      {/* Filter Button — the only filter trigger on Discover besides the quiet
          line. Shows a gold count badge when filters are active so the user
          can tell at a glance. */}
      <button
        className="discover-settings-btn"
        onClick={() => { hapticTap('light'); onOpenFilters?.() }}
        aria-label={
          activeFiltersCount > 0
            ? `Open filters (${activeFiltersCount} active)`
            : 'Open filters'
        }
      >
        <SettingsIcon />
        {activeFiltersCount > 0 && (
          <span className="discover-settings-btn-badge" aria-hidden="true">
            {activeFiltersCount}
          </span>
        )}
      </button>

      {/* I'm Bored Button - opens personalized recommendations */}
      <div className="boredom-btn-wrapper">
        <motion.button
          className="boredom-btn"
          onClick={() => { hapticTap('medium'); onTriggerJustGo?.() }}
          disabled={justGoDisabled}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={!justGoDisabled ? { scale: 1.03, y: -2 } : {}}
          whileTap={!justGoDisabled ? { scale: 0.97 } : {}}
          transition={{ delay: 0.2, type: 'spring', stiffness: 300, damping: 20 }}
          title={
            !hasLocation
              ? 'Waiting for location...'
              : placesCount === 0
                ? 'Loading places...'
                : 'Get a random recommendation!'
          }
        >
          <div className="boredom-btn-content">
            <motion.span
              className="boredom-btn-emoji"
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
              aria-hidden="true"
            >
              {/* Was 🎲 emoji — replaced with a branded SVG die so the
                  button matches the rest of ROAM's bespoke
                  iconography (compass, category badges, etc.) instead
                  of rendering whatever each platform's emoji set looks
                  like (Android ones in particular are wildly
                  inconsistent across versions). */}
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="18" height="18" rx="4"
                  fill="currentColor" opacity="0.18"
                  stroke="currentColor" strokeWidth="1.6" />
                <circle cx="8" cy="8" r="1.6" fill="currentColor" />
                <circle cx="16" cy="8" r="1.6" fill="currentColor" />
                <circle cx="12" cy="12" r="1.6" fill="currentColor" />
                <circle cx="8" cy="16" r="1.6" fill="currentColor" />
                <circle cx="16" cy="16" r="1.6" fill="currentColor" />
              </svg>
            </motion.span>
            <span className="boredom-btn-text">I'm bored</span>
          </div>
        </motion.button>
        {/* Tooltip explaining disabled state. Hidden while the load-error
            card is up: "Finding places nearby..." contradicts it. */}
        {justGoDisabled && !loading && !loadError && (
          <motion.span
            className="boredom-btn-tooltip"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            {tooltipText}
          </motion.span>
        )}
      </div>
    </header>
  )
}

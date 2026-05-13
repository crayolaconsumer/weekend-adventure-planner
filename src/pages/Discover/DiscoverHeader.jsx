import { motion } from 'framer-motion'
import StreakIndicator from '../../components/StreakIndicator'
import FilterIcon from '../../components/icons/FilterIcon'
import { SettingsIcon } from './icons'

/**
 * Discover hero/header block: wordmark + tagline + streak indicator,
 * filter-modal trigger (top-left cog with active-filter badge), "I'm Bored"
 * CTA + tooltip, plus the weather / travel-mode status row.
 *
 * Pure presentational — receives the data and callbacks it needs, doesn't
 * own state. The boredom button is disabled until we have a location and
 * at least one place; the tooltip explains the disabled reason.
 */
export default function DiscoverHeader({
  streak,
  activeFiltersCount,
  hasLocation,
  placesCount,
  loading,
  weather,
  travelMode,
  travelModeLabel,
  onOpenFilters,
  onTriggerJustGo,
}) {
  const justGoDisabled = !hasLocation || placesCount === 0
  const tooltipText = !hasLocation
    ? 'Getting your location...'
    : 'Finding places nearby...'

  return (
    <header className="discover-header">
      <motion.div
        className="discover-hero"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="discover-wordmark">ROAM</h1>
        <p className="discover-tagline">Stop scrolling. Start roaming.</p>
        <StreakIndicator streak={streak} />
      </motion.div>

      {/* Filter Button — the only filter trigger on Discover. Shows a gold
          count badge when filters are active so the user can tell at a glance. */}
      <button
        className="discover-settings-btn"
        onClick={onOpenFilters}
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
          onClick={onTriggerJustGo}
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
            >
              🎲
            </motion.span>
            <span className="boredom-btn-text">I'm Bored</span>
          </div>
        </motion.button>
        {/* Tooltip explaining disabled state */}
        {justGoDisabled && !loading && (
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

      {/* Weather & Mode indicator */}
      <div className="discover-status">
        {weather && (
          <div className="discover-weather">
            <span>{Math.round(weather.temperature)}°</span>
            <span>{weather.description}</span>
          </div>
        )}
        <div className="discover-mode">
          <FilterIcon name={travelMode} size={18} />
          <span>{travelModeLabel}</span>
        </div>
      </div>
    </header>
  )
}

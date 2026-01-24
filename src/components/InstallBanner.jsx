import { motion, AnimatePresence } from 'framer-motion'
import { usePWAInstall } from '../hooks/usePWAInstall'
import './InstallBanner.css'

/**
 * PWA Install Banner
 * Shows a non-intrusive banner when the app can be installed
 */
export default function InstallBanner() {
  const { canInstall, installApp, dismissPrompt } = usePWAInstall()

  const handleInstall = async () => {
    const installed = await installApp()
    if (installed) {
      // Could show a success toast here
    }
  }

  return (
    <AnimatePresence>
      {canInstall && (
        <motion.div
          className="install-banner"
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <div className="install-banner-content">
            <div className="install-banner-icon">
              <img src="/icons/icon-192.png" alt="ROAM" width="40" height="40" />
            </div>
            <div className="install-banner-text">
              <strong>Add ROAM to Home Screen</strong>
              <span>Quick access, works offline</span>
            </div>
          </div>
          <div className="install-banner-actions">
            <button
              className="install-banner-dismiss"
              onClick={dismissPrompt}
              aria-label="Dismiss"
            >
              Not now
            </button>
            <button
              className="install-banner-install"
              onClick={handleInstall}
            >
              Install
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

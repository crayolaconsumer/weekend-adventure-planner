import { motion, AnimatePresence } from 'framer-motion'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useOfflinePack } from '../hooks/useOfflinePack'
import './OfflineIndicator.css'

export default function OfflineIndicator() {
  const online = useOnlineStatus()
  const { status } = useOfflinePack()

  const hasPack = status.state === 'fresh' || status.state === 'stale-time' || status.state === 'stale-distance'
  const message = hasPack
    ? 'Offline — using your downloaded pack'
    : 'Offline — limited functionality'

  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          className={`offline-indicator ${hasPack ? 'with-pack' : 'no-pack'}`}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          role="status"
          aria-live="polite"
        >
          <span className="offline-indicator-dot" />
          <span className="offline-indicator-text">{message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

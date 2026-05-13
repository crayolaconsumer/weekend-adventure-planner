import { BackIcon } from './icons'

/**
 * Skeleton shown while the profile + stats are loading.
 */
export default function ProfileSkeleton() {
  return (
    <div className="page unified-profile-page">
      <header className="unified-profile-header">
        <div className="unified-profile-back">
          <BackIcon />
        </div>
      </header>

      <div className="unified-profile-card">
        <div className="unified-profile-avatar skeleton" />
        <div className="unified-profile-info">
          <div className="skeleton" style={{ width: '150px', height: '28px', marginBottom: '8px' }} />
          <div className="skeleton" style={{ width: '100px', height: '16px' }} />
        </div>
      </div>

      <div className="unified-profile-stats">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="unified-profile-stat">
            <div className="skeleton" style={{ width: '40px', height: '24px', marginBottom: '4px' }} />
            <div className="skeleton" style={{ width: '60px', height: '14px' }} />
          </div>
        ))}
      </div>
    </div>
  )
}

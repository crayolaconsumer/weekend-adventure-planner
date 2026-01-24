/**
 * PrivacySettings Component
 *
 * Privacy controls UI for the Settings tab
 */

import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { usePrivacySettings } from '../hooks/usePrivacySettings'
import { useFollowRequests } from '../hooks/useFollowRequests'
import FollowRequestsModal from './FollowRequestsModal'
import BlockedUsersModal from './BlockedUsersModal'
import './PrivacySettings.css'

export default function PrivacySettings() {
  const {
    settings,
    pendingRequestCount,
    loading,
    saving,
    updateSettings,
    refresh
  } = usePrivacySettings()

  const [showRequestsModal, setShowRequestsModal] = useState(false)
  const [showBlockedModal, setShowBlockedModal] = useState(false)
  const [localSettings, setLocalSettings] = useState(null)

  // Use local settings if available, otherwise use fetched settings
  const currentSettings = localSettings || settings

  const handleToggle = useCallback(async (key) => {
    if (!currentSettings) return

    const newValue = !currentSettings[key]
    const updates = { [key]: newValue }

    // Optimistic update
    setLocalSettings(prev => ({
      ...(prev || currentSettings),
      [key]: newValue
    }))

    const result = await updateSettings(updates)

    if (!result.success) {
      // Revert on error
      setLocalSettings(null)
    } else {
      setLocalSettings(null) // Clear local state, use server state
    }
  }, [currentSettings, updateSettings])

  if (loading && !settings) {
    return (
      <div className="privacy-settings-loading">
        <div className="privacy-settings-spinner" />
        <span>Loading privacy settings...</span>
      </div>
    )
  }

  return (
    <div className="privacy-settings">
      <h3 className="privacy-settings-title">Privacy</h3>

      {/* Private Account Toggle */}
      <button
        className={`privacy-settings-toggle ${currentSettings?.isPrivateAccount ? 'active' : ''}`}
        onClick={() => handleToggle('isPrivateAccount')}
        disabled={saving}
        aria-pressed={currentSettings?.isPrivateAccount}
      >
        <span className="toggle-icon">
          <LockIcon locked={currentSettings?.isPrivateAccount} />
        </span>
        <span className="toggle-text">
          <span className="toggle-label">Private Account</span>
          <span className="toggle-desc">
            Only approved followers can see your activity
          </span>
        </span>
        <span className={`toggle-switch ${currentSettings?.isPrivateAccount ? 'on' : ''}`}>
          <span className="toggle-knob" />
        </span>
      </button>

      {/* Follow Requests (only show if private) */}
      {currentSettings?.isPrivateAccount && (
        <motion.button
          className="privacy-settings-link"
          onClick={() => setShowRequestsModal(true)}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
        >
          <span className="link-icon">
            <UsersIcon />
          </span>
          <span className="link-text">
            <span className="link-label">Follow Requests</span>
            {pendingRequestCount > 0 && (
              <span className="link-badge">{pendingRequestCount}</span>
            )}
          </span>
          <ChevronIcon />
        </motion.button>
      )}

      {/* Show in Search Toggle */}
      <button
        className={`privacy-settings-toggle ${currentSettings?.showInSearch ? 'active' : ''}`}
        onClick={() => handleToggle('showInSearch')}
        disabled={saving}
        aria-pressed={currentSettings?.showInSearch}
      >
        <span className="toggle-icon">
          <SearchIcon />
        </span>
        <span className="toggle-text">
          <span className="toggle-label">Appear in Search</span>
          <span className="toggle-desc">
            Let others find you by searching your username
          </span>
        </span>
        <span className={`toggle-switch ${currentSettings?.showInSearch ? 'on' : ''}`}>
          <span className="toggle-knob" />
        </span>
      </button>

      {/* Hide Followers List Toggle */}
      <button
        className={`privacy-settings-toggle ${currentSettings?.hideFollowersList ? 'active' : ''}`}
        onClick={() => handleToggle('hideFollowersList')}
        disabled={saving}
        aria-pressed={currentSettings?.hideFollowersList}
      >
        <span className="toggle-icon">
          <EyeOffIcon />
        </span>
        <span className="toggle-text">
          <span className="toggle-label">Hide Followers</span>
          <span className="toggle-desc">
            Others can't see who follows you
          </span>
        </span>
        <span className={`toggle-switch ${currentSettings?.hideFollowersList ? 'on' : ''}`}>
          <span className="toggle-knob" />
        </span>
      </button>

      {/* Hide Following List Toggle */}
      <button
        className={`privacy-settings-toggle ${currentSettings?.hideFollowingList ? 'active' : ''}`}
        onClick={() => handleToggle('hideFollowingList')}
        disabled={saving}
        aria-pressed={currentSettings?.hideFollowingList}
      >
        <span className="toggle-icon">
          <EyeOffIcon />
        </span>
        <span className="toggle-text">
          <span className="toggle-label">Hide Following</span>
          <span className="toggle-desc">
            Others can't see who you follow
          </span>
        </span>
        <span className={`toggle-switch ${currentSettings?.hideFollowingList ? 'on' : ''}`}>
          <span className="toggle-knob" />
        </span>
      </button>

      {/* Blocked Users Link */}
      <button
        className="privacy-settings-link"
        onClick={() => setShowBlockedModal(true)}
      >
        <span className="link-icon">
          <BlockIcon />
        </span>
        <span className="link-text">
          <span className="link-label">Blocked Users</span>
        </span>
        <ChevronIcon />
      </button>

      {/* Follow Requests Modal */}
      {showRequestsModal && (
        <FollowRequestsModal
          onClose={() => {
            setShowRequestsModal(false)
            refresh() // Refresh pending count
          }}
        />
      )}

      {/* Blocked Users Modal */}
      {showBlockedModal && (
        <BlockedUsersModal
          onClose={() => setShowBlockedModal(false)}
        />
      )}
    </div>
  )
}

// Icons
function LockIcon({ locked }) {
  if (locked) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    )
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )
}

function BlockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  )
}

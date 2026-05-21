import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme } from '../../contexts/ThemeContext'
import { useDistance } from '../../contexts/DistanceContext'
import { useSubscription } from '../../hooks/useSubscription'
import { isNative, getPlatform } from '../../utils/nativeBridge'
import { openExternalLink } from '../../utils/navigation'
import PremiumBadge from '../../components/PremiumBadge'
import OfflinePackCard from '../../components/OfflinePackCard'
import PrivacySettings from '../../components/PrivacySettings'
import ConfirmModal from '../../components/ConfirmModal'
import ToggleIcon from '../../components/icons/SettingsIcon'
import FilterIcon from '../../components/icons/FilterIcon'
import { LogOutIcon } from './icons'
import NotificationsSection from './NotificationsSection'

/**
 * Account / preferences / premium management tab.
 *
 * Owns ALL profile-level state (display name, username, travel mode,
 * accessibility toggles, etc.) and bundles edits into one /api/auth
 * patch on save so partial failure can't leave the user with a
 * displayName saved but username rejected.
 *
 * The delete-account flow lives here because App Store Review 5.1.1(v)
 * requires the path to be reachable from the account screen.
 */
export default function SettingsTab({ user, onLogout }) {
  const { updateProfile, deleteAccount } = useAuth()
  const { isPremium, manageSubscription, loading: subLoading, error: subError, expiresAt, isCancelled } = useSubscription()
  const { distanceUnit, setDistanceUnit } = useDistance()
  const { preference: themePref, setPreference: setThemePref } = useTheme()
  const navigate = useNavigate()

  // Delete-account confirm flow — App Store Review 5.1.1(v)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteUsernameInput, setDeleteUsernameInput] = useState('')
  const [deleteError, setDeleteError] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const handleConfirmDelete = async () => {
    setDeleteError(null)
    setDeleteBusy(true)
    const result = await deleteAccount(deleteUsernameInput)
    setDeleteBusy(false)
    if (result.success) {
      setShowDeleteConfirm(false)
      navigate('/', { replace: true })
    } else if (result.code === 'STALE_SESSION') {
      setDeleteError('For security, please sign in again before deleting your account.')
    } else {
      setDeleteError(result.error || 'Account deletion failed. Try again or email hello@go-roam.uk')
    }
  }

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Form state for account info
  const [displayName, setDisplayName] = useState(user?.displayName || '')
  // Username is stored lowercase server-side. We let the user type any case
  // — comparison + submission normalise to lower so case differences don't
  // false-trigger "unsaved changes" or a redundant API call.
  const [usernameInput, setUsernameInput] = useState(user?.username || '')

  // Preferences state (localStorage-backed)
  const [travelMode, setTravelMode] = useState(() =>
    localStorage.getItem('roam_travel_mode') || 'walking',
  )
  const [freeOnly, setFreeOnly] = useState(() =>
    localStorage.getItem('roam_free_only') === 'true',
  )
  const [accessibilityMode, setAccessibilityMode] = useState(() =>
    localStorage.getItem('roam_accessibility') === 'true',
  )
  const [openOnly, setOpenOnly] = useState(() =>
    localStorage.getItem('roam_open_only') === 'true',
  )

  // Travel mode options. Icon comes from FilterIcon via the mode key,
  // so no emoji field is needed here.
  const travelModes = {
    walking: { label: 'Walking', desc: 'Up to 5km' },
    driving: { label: 'Driving', desc: 'Up to 30km' },
    transit: { label: 'Transit', desc: 'Up to 15km' },
  }

  // Reset form when user changes
  useEffect(() => {
    setDisplayName(user?.displayName || '')
  }, [user?.displayName])
  useEffect(() => {
    setUsernameInput(user?.username || '')
  }, [user?.username])

  // Client-mirror of server validation (api/auth/index.js handleUpdateProfile).
  // Keep these in sync — drift causes the form to show a green checkmark
  // while the server returns 400.
  const normalizedUsername = usernameInput.trim().toLowerCase()
  const usernameChanged = normalizedUsername !== (user?.username || '').toLowerCase()
  const usernameError = !usernameChanged ? null :
    normalizedUsername.length < 3 ? 'Must be at least 3 characters' :
    normalizedUsername.length > 30 ? 'Must be 30 characters or less' :
    !/^[a-z0-9_]+$/.test(normalizedUsername) ? 'Only letters, numbers, and underscores' :
    null

  // Track if there are unsaved changes
  const hasUnsavedChanges = isEditing && (
    displayName !== (user?.displayName || '') ||
    usernameChanged ||
    travelMode !== (localStorage.getItem('roam_travel_mode') || 'walking') ||
    freeOnly !== (localStorage.getItem('roam_free_only') === 'true') ||
    accessibilityMode !== (localStorage.getItem('roam_accessibility') === 'true') ||
    openOnly !== (localStorage.getItem('roam_open_only') === 'true')
  )

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault()
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?'
        return e.returnValue
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  // Save preferences to localStorage
  const savePreferences = useCallback(() => {
    localStorage.setItem('roam_travel_mode', travelMode)
    localStorage.setItem('roam_free_only', freeOnly.toString())
    localStorage.setItem('roam_accessibility', accessibilityMode.toString())
    localStorage.setItem('roam_open_only', openOnly.toString())
  }, [travelMode, freeOnly, accessibilityMode, openOnly])

  // Handle save
  const handleSave = async () => {
    setSaveError('')
    setSaveSuccess(false)

    // Client-side guard — server still re-validates, but failing fast
    // avoids a 400 round-trip and gives a focused error message.
    if (usernameChanged && usernameError) {
      setSaveError(usernameError)
      return
    }

    setIsSaving(true)
    try {
      // Bundle account changes into one /api/auth update call so partial
      // failure can't leave the user with displayName saved but username
      // rejected (or vice versa).
      const accountPatch = {}
      if (displayName !== (user?.displayName || '')) {
        accountPatch.displayName = displayName || null
      }
      if (usernameChanged) {
        accountPatch.username = normalizedUsername
      }

      if (Object.keys(accountPatch).length > 0) {
        const result = await updateProfile(accountPatch)
        if (!result.success) {
          throw new Error(result.error)
        }
      }

      // Save preferences to localStorage
      savePreferences()

      setSaveSuccess(true)
      setIsEditing(false)

      // If the username changed, the current URL still has the old
      // username as a route param and useUserProfile will refetch the
      // OLD user (404 if it ever existed for someone else, stale data
      // otherwise). Navigate to the new URL so everything stays
      // consistent.
      if (usernameChanged) {
        navigate(`/user/${normalizedUsername}`, { replace: true })
      }

      // Clear success message after 3s
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      setSaveError(err.message || 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  // Handle cancel
  const handleCancel = () => {
    // Reset form to current values
    setDisplayName(user?.displayName || '')
    setUsernameInput(user?.username || '')
    setTravelMode(localStorage.getItem('roam_travel_mode') || 'walking')
    setFreeOnly(localStorage.getItem('roam_free_only') === 'true')
    setAccessibilityMode(localStorage.getItem('roam_accessibility') === 'true')
    setOpenOnly(localStorage.getItem('roam_open_only') === 'true')
    setSaveError('')
    setIsEditing(false)
  }

  return (
    <div className="unified-profile-settings">
      {/* Premium Section */}
      {!isPremium ? (
        <div className="unified-profile-settings-section premium-upgrade-section">
          <Link to="/pricing" className="profile-upgrade-card">
            <div className="profile-upgrade-card-badge">
              <PremiumBadge size="hero" showBevel={true} />
            </div>
            <div className="profile-upgrade-card-body">
              <span className="profile-upgrade-card-eyebrow">ROAM+</span>
              <span className="profile-upgrade-card-headline">Make every weekend matter.</span>
              <span className="profile-upgrade-card-sub">
                Unlimited saves, offline maps, no ads, and a scout badge on your profile.
              </span>
              <span className="profile-upgrade-card-cta">
                Unlock with ROAM+ →
              </span>
            </div>
          </Link>
        </div>
      ) : (
        <div className="unified-profile-settings-section premium-active-section">
          <div className="premium-status-card">
            <div className="premium-status-header">
              <span className="premium-status-badge">
                <PremiumBadge size="md" showBevel={true} />
                ROAM+ Member
              </span>
            </div>
            <p className="premium-status-perks">Unlimited saves, offline maps, ad-free, and your scout badge.</p>
            {expiresAt && (
              <p className="premium-status-expiry">
                {isCancelled
                  ? `Access until ${new Date(expiresAt).toLocaleDateString()}`
                  : `Renews ${new Date(expiresAt).toLocaleDateString()}`
                }
              </p>
            )}
            {isCancelled && (
              <p className="premium-status-cancelled">Your subscription won't renew</p>
            )}
            <button
              className="premium-manage-btn"
              onClick={() => {
                // Native: subscription management lives in the platform's
                // own subscription manager — required by App Store Review
                // 3.1.2 (iOS) and good UX on Android. Deep-link straight
                // to the user's subscriptions list so they can cancel or
                // modify with one tap.
                if (isNative()) {
                  const platform = getPlatform()
                  // Android: deep-link with our package + product so
                  //   Play Store opens the user's ROAM+ subscription
                  //   directly rather than the all-subs list.
                  // iOS: https://apps.apple.com auto-redirects to App
                  //   Store app's Subscriptions page (system handles).
                  const url = platform === 'android'
                    ? 'https://play.google.com/store/account/subscriptions?package=com.goroam.app&sku=roam_premium_monthly'
                    : 'https://apps.apple.com/account/subscriptions'
                  openExternalLink(url)
                  return
                }
                manageSubscription()
              }}
              disabled={subLoading}
            >
              {subLoading ? 'Loading...' : 'Manage Subscription'}
            </button>
            {/* Hide the iap-not-available code from users — it's the
                internal signal that this surface should route through
                Apple's subscription manager (handled by the click above),
                not a real error worth displaying. */}
            {subError && subError !== 'iap-not-available' && (
              <div className="premium-manage-error-container">
                <p className="premium-manage-error">{subError}</p>
                {subError.includes('Subscribe') && (
                  <Link to="/pricing" className="premium-manage-subscribe-link">
                    Subscribe to ROAM+
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Success Message */}
      {saveSuccess && (
        <div className="unified-profile-settings-success" role="status">
          Settings saved successfully
        </div>
      )}

      {/* Error Message */}
      {saveError && (
        <div className="unified-profile-settings-error" role="alert">
          {saveError}
        </div>
      )}

      {/* Account Info */}
      <div className="unified-profile-settings-section">
        <div className="unified-profile-settings-header">
          <h3 className="unified-profile-settings-title">Account</h3>
          {!isEditing && (
            <button
              className="unified-profile-settings-edit-btn"
              onClick={() => setIsEditing(true)}
            >
              Edit
            </button>
          )}
        </div>

        <div className="unified-profile-settings-item">
          <span className="unified-profile-settings-label">Email</span>
          <span className="unified-profile-settings-value">{user?.email || 'Not set'}</span>
        </div>

        {isEditing ? (
          <div className="unified-profile-settings-field">
            <label htmlFor="username" className="unified-profile-settings-label">
              Username
            </label>
            <div className="unified-profile-settings-username-row">
              <span className="unified-profile-settings-username-prefix">@</span>
              <input
                id="username"
                type="text"
                className="unified-profile-settings-input unified-profile-settings-input--username"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value.replace(/\s/g, ''))}
                placeholder="username"
                maxLength={30}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                disabled={isSaving}
              />
            </div>
            <span className={`unified-profile-settings-hint${usernameError ? ' is-error' : ''}`}>
              {usernameError || '3–30 characters · letters, numbers, underscores'}
            </span>
          </div>
        ) : (
          <div className="unified-profile-settings-item">
            <span className="unified-profile-settings-label">Username</span>
            <span className="unified-profile-settings-value">@{user?.username}</span>
          </div>
        )}

        {isEditing ? (
          <div className="unified-profile-settings-field">
            <label htmlFor="displayName" className="unified-profile-settings-label">
              Display Name
            </label>
            <input
              id="displayName"
              type="text"
              className="unified-profile-settings-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter display name"
              maxLength={50}
              disabled={isSaving}
            />
          </div>
        ) : (
          <div className="unified-profile-settings-item">
            <span className="unified-profile-settings-label">Display Name</span>
            <span className="unified-profile-settings-value">
              {user?.displayName || user?.username || 'Not set'}
            </span>
          </div>
        )}

        {/* Save/Cancel — sits inside the Account block so it's visible
            right next to the inputs being edited. Previously this was
            below Preferences, three scroll-screens away, and testers
            consistently thought the form was broken. */}
        {isEditing && (
          <div className="unified-profile-settings-actions">
            <button
              className="unified-profile-settings-cancel-btn"
              onClick={handleCancel}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              className="unified-profile-settings-save-btn"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>

      {/* Preferences */}
      <div className="unified-profile-settings-section">
        <h3 className="unified-profile-settings-title">Preferences</h3>

        {/* Travel Mode */}
        <div className="unified-profile-settings-field">
          <span className="unified-profile-settings-label">Default Travel Mode</span>
          <div className="unified-profile-settings-mode-grid">
            {Object.entries(travelModes).map(([key, mode]) => (
              <button
                key={key}
                className={`unified-profile-settings-mode-btn ${travelMode === key ? 'active' : ''}`}
                onClick={() => {
                  setTravelMode(key)
                  if (!isEditing) {
                    localStorage.setItem('roam_travel_mode', key)
                  }
                }}
                disabled={isSaving}
              >
                <span className="mode-icon"><FilterIcon name={key} size={24} /></span>
                <span className="mode-label">{mode.label}</span>
                <span className="mode-desc">{mode.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Distance Units */}
        <div className="unified-profile-settings-field">
          <span className="unified-profile-settings-label">Distance Units</span>
          <div className="unified-profile-settings-segment">
            <button
              className={`unified-profile-settings-segment-btn ${distanceUnit === 'km' ? 'active' : ''}`}
              onClick={() => setDistanceUnit('km')}
              disabled={isSaving}
            >
              Kilometers
            </button>
            <button
              className={`unified-profile-settings-segment-btn ${distanceUnit === 'mi' ? 'active' : ''}`}
              onClick={() => setDistanceUnit('mi')}
              disabled={isSaving}
            >
              Miles
            </button>
          </div>
        </div>

        {/* Appearance — 3-state: System / Light / Dark.
            "System" follows the user's iOS / browser preference and
            flips automatically if they change it. "Light" / "Dark"
            override. Default is "System" so most users get the right
            theme without ever touching settings. */}
        <div className="unified-profile-settings-field">
          <span className="unified-profile-settings-label">Appearance</span>
          <div className="unified-profile-settings-segment">
            <button
              className={`unified-profile-settings-segment-btn ${themePref === 'system' ? 'active' : ''}`}
              onClick={() => setThemePref('system')}
              disabled={isSaving}
            >
              System
            </button>
            <button
              className={`unified-profile-settings-segment-btn ${themePref === 'light' ? 'active' : ''}`}
              onClick={() => setThemePref('light')}
              disabled={isSaving}
            >
              Light
            </button>
            <button
              className={`unified-profile-settings-segment-btn ${themePref === 'dark' ? 'active' : ''}`}
              onClick={() => setThemePref('dark')}
              disabled={isSaving}
            >
              Dark
            </button>
          </div>
        </div>

        {/* Toggle Preferences */}
        <div className="unified-profile-settings-toggles">
          <button
            className={`unified-profile-settings-toggle ${freeOnly ? 'active' : ''}`}
            onClick={() => {
              const newValue = !freeOnly
              setFreeOnly(newValue)
              if (!isEditing) {
                localStorage.setItem('roam_free_only', newValue.toString())
              }
            }}
            disabled={isSaving}
            aria-pressed={freeOnly}
          >
            <span className="toggle-icon"><ToggleIcon name="free" size={20} /></span>
            <span className="toggle-text">
              <span className="toggle-label">Free Places Only</span>
              <span className="toggle-desc">Show only free attractions</span>
            </span>
            <span className={`toggle-switch ${freeOnly ? 'on' : ''}`}>
              <span className="toggle-knob" />
            </span>
          </button>

          <button
            className={`unified-profile-settings-toggle ${accessibilityMode ? 'active' : ''}`}
            onClick={() => {
              const newValue = !accessibilityMode
              setAccessibilityMode(newValue)
              if (!isEditing) {
                localStorage.setItem('roam_accessibility', newValue.toString())
              }
            }}
            disabled={isSaving}
            aria-pressed={accessibilityMode}
          >
            <span className="toggle-icon"><ToggleIcon name="accessibility" size={20} /></span>
            <span className="toggle-text">
              <span className="toggle-label">Accessibility Mode</span>
              <span className="toggle-desc">Prioritize accessible places</span>
            </span>
            <span className={`toggle-switch ${accessibilityMode ? 'on' : ''}`}>
              <span className="toggle-knob" />
            </span>
          </button>

          <button
            className={`unified-profile-settings-toggle ${openOnly ? 'active' : ''}`}
            onClick={() => {
              const newValue = !openOnly
              setOpenOnly(newValue)
              if (!isEditing) {
                localStorage.setItem('roam_open_only', newValue.toString())
              }
            }}
            disabled={isSaving}
            aria-pressed={openOnly}
          >
            <span className="toggle-icon"><ToggleIcon name="clock" size={20} /></span>
            <span className="toggle-text">
              <span className="toggle-label">Open Now Only</span>
              <span className="toggle-desc">Hide places that are closed</span>
            </span>
            <span className={`toggle-switch ${openOnly ? 'on' : ''}`}>
              <span className="toggle-knob" />
            </span>
          </button>
        </div>
      </div>

      {/* Notifications Section */}
      <NotificationsSection user={user} />

      {/* Offline Pack Section (premium-gated; locked teaser for free users) */}
      <div className="unified-profile-settings-section">
        <OfflinePackCard />
      </div>

      {/* Privacy Settings */}
      <div className="unified-profile-settings-section">
        <PrivacySettings />
      </div>

      {/* Legal + Support — App Store Review 1.2 (contact info), 5.1.1
          (privacy policy), 3.1.2 (terms of use for subscriptions). All
          three must be reachable from within the app. */}
      <div className="unified-profile-settings-section">
        <h3 className="unified-profile-section-title">Legal & Support</h3>
        {/* In-app navigation — `<a target="_blank">` is a dead-end inside
            the Capacitor WKWebView (no SFSafariViewController plugin wired),
            and we have full-fledged /privacy /terms /support routes
            already, so the legal pages render natively inside the app. */}
        <Link to="/privacy" className="unified-profile-settings-link-row">
          Privacy Policy
        </Link>
        <Link to="/terms" className="unified-profile-settings-link-row">
          Terms of Use
        </Link>
        <Link to="/support" className="unified-profile-settings-link-row">
          Contact Support
        </Link>
      </div>

      {/* Sign Out */}
      <button className="unified-profile-logout-btn" onClick={onLogout}>
        <LogOutIcon />
        Sign Out
      </button>

      {/* Delete Account — App Store Review 5.1.1(v) */}
      <button
        className="unified-profile-delete-btn"
        onClick={() => { setDeleteUsernameInput(''); setDeleteError(null); setShowDeleteConfirm(true) }}
      >
        Delete account
      </button>

      <ConfirmModal
        isOpen={showDeleteConfirm}
        title="Delete your account?"
        message={
          <>
            This is permanent. We'll delete your profile, saves, reviews, photos and
            cancel any active subscription. To confirm, type your username{' '}
            <strong>@{user?.username}</strong> below.
            <input
              type="text"
              value={deleteUsernameInput}
              onChange={(e) => setDeleteUsernameInput(e.target.value)}
              placeholder={user?.username}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck="false"
              style={{
                display: 'block',
                marginTop: 12,
                width: '100%',
                padding: '10px 12px',
                border: '1px solid rgba(26,58,47,0.2)',
                borderRadius: 8,
                fontSize: 15,
                background: '#fff',
              }}
            />
            {deleteError && (
              <span style={{ display: 'block', marginTop: 8, color: '#b22d2d', fontSize: 13 }}>
                {deleteError}
              </span>
            )}
          </>
        }
        confirmLabel={deleteBusy ? 'Deleting…' : 'Delete forever'}
        cancelLabel="Cancel"
        destructive
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}

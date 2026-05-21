import { useState, useEffect } from 'react'
import ToggleIcon from '../../components/icons/SettingsIcon'
import { PUSH_OPT_IN_KEY, usePushNotifications } from '../../hooks/usePushNotifications'
import { getAuthToken } from './utils'

/**
 * Push notification settings — master subscribe toggle plus granular
 * preferences (new follower, new contribution, plan shared, weekly
 * digest, visit reminder).
 *
 * Renders one of three states depending on browser/permission:
 *   - "Not supported" (e.g. iOS web outside add-to-home-screen).
 *   - "Blocked" (user denied at OS level).
 *   - Subscribe toggle + per-category prefs.
 */
export default function NotificationsSection({ user }) {
  const {
    supported,
    permission,
    isSubscribed,
    loading,
    error,
    subscribe,
    unsubscribe,
  } = usePushNotifications()

  // Notification preferences state
  const [prefs, setPrefs] = useState({
    newFollower: true,
    newContribution: true,
    planShared: true,
    weeklyDigest: true,
    visitReminder: true,
  })
  const [prefsLoading, setPrefsLoading] = useState(true)
  const [diagnostics, setDiagnostics] = useState(null)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(true)
  const [diagnosticsError, setDiagnosticsError] = useState(null)
  const [testLoading, setTestLoading] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const showDiagnosticsAction = Boolean(user?.isAdmin) ||
    new URLSearchParams(window.location.search).get('diagnostics') === '1'

  // Load notification preferences
  useEffect(() => {
    const loadPrefs = async () => {
      const token = getAuthToken()
      if (!token) {
        setPrefsLoading(false)
        return
      }

      try {
        const response = await fetch('/api/users/notification-preferences', {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        })
        if (response.ok) {
          const data = await response.json()
          setPrefs(data.preferences)
        }
      } catch (err) {
        console.error('Failed to load notification preferences:', err)
      } finally {
        setPrefsLoading(false)
      }
    }

    loadPrefs()
  }, [])

  useEffect(() => {
    const loadDiagnostics = async () => {
      const token = getAuthToken()
      if (!token) {
        setDiagnosticsLoading(false)
        return
      }

      try {
        const response = await fetch('/api/diagnostics/push', {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        })
        if (!response.ok) {
          throw new Error('Failed to load push diagnostics')
        }
        const data = await response.json()
        setDiagnostics(data)
        setTestResult(data.lastTest?.result || null)
      } catch (err) {
        setDiagnosticsError(err.message || 'Failed to load push diagnostics')
      } finally {
        setDiagnosticsLoading(false)
      }
    }

    loadDiagnostics()
  }, [])

  // Update a specific preference
  const updatePref = async (key, value) => {
    // Optimistic update
    setPrefs(prev => ({ ...prev, [key]: value }))

    const token = getAuthToken()
    if (!token) return

    try {
      await fetch('/api/users/notification-preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({ [key]: value }),
      })
    } catch (err) {
      // Revert on error
      setPrefs(prev => ({ ...prev, [key]: !value }))
      console.error('Failed to update notification preference:', err)
    }
  }

  const handleToggle = async () => {
    if (isSubscribed) {
      await unsubscribe()
    } else {
      localStorage.setItem(PUSH_OPT_IN_KEY, 'true')
      await subscribe()
    }
  }

  const handleSendTest = async () => {
    const token = getAuthToken()
    if (!token) return

    setTestLoading(true)
    setDiagnosticsError(null)
    try {
      const response = await fetch('/api/diagnostics/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({ test: true }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to send test notification')
      }
      setDiagnostics(data)
      setTestResult(data.test)
    } catch (err) {
      setDiagnosticsError(err.message || 'Failed to send test notification')
    } finally {
      setTestLoading(false)
    }
  }

  const subscriptionCount = diagnostics?.subscriptions?.platforms?.length ?? 0
  const diagnosticDeliveries = testResult?.deliveries || []
  const permissionLabel = supported ? permission : 'unsupported'

  const diagnosticsPanel = (
    <div className="unified-profile-push-diagnostics">
      <div className="unified-profile-settings-item">
        <span className="unified-profile-settings-label">Push Status</span>
        <span className="unified-profile-settings-value">
          {permissionLabel} · {diagnosticsLoading ? 'loading subscriptions' : `${subscriptionCount} registered`}
        </span>
      </div>

      {showDiagnosticsAction && (
        <div className="unified-profile-push-test">
          <button
            type="button"
            className="unified-profile-settings-save-btn unified-profile-push-test-btn"
            onClick={handleSendTest}
            disabled={testLoading || diagnosticsLoading}
          >
            {testLoading ? 'Sending...' : 'Send test notification'}
          </button>

          {diagnosticDeliveries.length > 0 && (
            <div className="unified-profile-push-results" aria-live="polite">
              {diagnosticDeliveries.map((result) => (
                <div key={`${result.platform}-${result.id}`} className="unified-profile-push-result">
                  <span>{result.platform}</span>
                  <span>{result.success ? `ok (${result.status || 'sent'})` : `failed${result.status ? ` (${result.status})` : ''}`}</span>
                  {!result.success && result.reason && (
                    <span className="unified-profile-push-result-reason">{result.reason}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {diagnosticsError && (
        <p className="unified-profile-settings-error-inline">{diagnosticsError}</p>
      )}
    </div>
  )

  // Not supported in this browser
  if (!supported) {
    return (
      <div className="unified-profile-settings-section">
        <h3 className="unified-profile-settings-title">Notifications</h3>
        {diagnosticsPanel}
        <p className="unified-profile-settings-unsupported">
          Push notifications are not supported in this browser.
        </p>
      </div>
    )
  }

  // Permission denied
  if (permission === 'denied') {
    return (
      <div className="unified-profile-settings-section">
        <h3 className="unified-profile-settings-title">Notifications</h3>
        {diagnosticsPanel}
        <p className="unified-profile-settings-blocked">
          Notifications are blocked. Enable them in your browser settings to receive updates.
        </p>
      </div>
    )
  }

  return (
    <div className="unified-profile-settings-section">
      <h3 className="unified-profile-settings-title">Notifications</h3>
      {diagnosticsPanel}

      <div className="unified-profile-settings-toggles">
        {/* Master push toggle */}
        <button
          className={`unified-profile-settings-toggle ${isSubscribed ? 'active' : ''}`}
          onClick={handleToggle}
          disabled={loading}
          aria-pressed={isSubscribed}
        >
          <span className="toggle-icon"><ToggleIcon name="bell" size={20} /></span>
          <span className="toggle-text">
            <span className="toggle-label">Push Notifications</span>
            <span className="toggle-desc">
              {isSubscribed
                ? 'Receiving notifications'
                : 'Enable to receive updates'}
            </span>
          </span>
          <span className={`toggle-switch ${isSubscribed ? 'on' : ''}`}>
            <span className="toggle-knob" />
          </span>
        </button>

        {/* Granular preferences - only show when subscribed */}
        {isSubscribed && prefsLoading && (
          <div className="unified-profile-settings-prefs-loading">
            <span className="unified-profile-spinner-small" />
            <span>Loading notification preferences...</span>
          </div>
        )}
        {isSubscribed && !prefsLoading && (
          <>
            <button
              className={`unified-profile-settings-toggle sub-toggle ${prefs.newFollower ? 'active' : ''}`}
              onClick={() => updatePref('newFollower', !prefs.newFollower)}
              aria-pressed={prefs.newFollower}
            >
              <span className="toggle-text">
                <span className="toggle-label">New Followers</span>
                <span className="toggle-desc">When someone follows you</span>
              </span>
              <span className={`toggle-switch ${prefs.newFollower ? 'on' : ''}`}>
                <span className="toggle-knob" />
              </span>
            </button>

            <button
              className={`unified-profile-settings-toggle sub-toggle ${prefs.newContribution ? 'active' : ''}`}
              onClick={() => updatePref('newContribution', !prefs.newContribution)}
              aria-pressed={prefs.newContribution}
            >
              <span className="toggle-icon"><ToggleIcon name="upvote" size={20} /></span>
              <span className="toggle-text">
                <span className="toggle-label">Tip Upvotes</span>
                <span className="toggle-desc">When your tips get upvoted</span>
              </span>
              <span className={`toggle-switch ${prefs.newContribution ? 'on' : ''}`}>
                <span className="toggle-knob" />
              </span>
            </button>

            <button
              className={`unified-profile-settings-toggle sub-toggle ${prefs.planShared ? 'active' : ''}`}
              onClick={() => updatePref('planShared', !prefs.planShared)}
              aria-pressed={prefs.planShared}
            >
              <span className="toggle-icon"><ToggleIcon name="map" size={20} /></span>
              <span className="toggle-text">
                <span className="toggle-label">Shared Plans</span>
                <span className="toggle-desc">When someone shares a plan with you</span>
              </span>
              <span className={`toggle-switch ${prefs.planShared ? 'on' : ''}`}>
                <span className="toggle-knob" />
              </span>
            </button>

            <button
              className={`unified-profile-settings-toggle sub-toggle ${prefs.weeklyDigest ? 'active' : ''}`}
              onClick={() => updatePref('weeklyDigest', !prefs.weeklyDigest)}
              aria-pressed={prefs.weeklyDigest}
            >
              <span className="toggle-icon"><ToggleIcon name="digest" size={20} /></span>
              <span className="toggle-text">
                <span className="toggle-label">Weekly Digest</span>
                <span className="toggle-desc">Weekly summary of activity</span>
              </span>
              <span className={`toggle-switch ${prefs.weeklyDigest ? 'on' : ''}`}>
                <span className="toggle-knob" />
              </span>
            </button>

            <button
              className={`unified-profile-settings-toggle sub-toggle ${prefs.visitReminder ? 'active' : ''}`}
              onClick={() => updatePref('visitReminder', !prefs.visitReminder)}
              aria-pressed={prefs.visitReminder}
            >
              <span className="toggle-icon"><ToggleIcon name="calendar" size={20} /></span>
              <span className="toggle-text">
                <span className="toggle-label">Visit Reminders</span>
                <span className="toggle-desc">Reminder on your planned visit day</span>
              </span>
              <span className={`toggle-switch ${prefs.visitReminder ? 'on' : ''}`}>
                <span className="toggle-knob" />
              </span>
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="unified-profile-settings-error-inline">{error}</p>
      )}
    </div>
  )
}

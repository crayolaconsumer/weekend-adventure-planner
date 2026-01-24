import { useState, useEffect } from 'react'

/**
 * Custom hook for PWA installation prompt
 * Captures the beforeinstallprompt event and provides methods to trigger install
 */
export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [canInstall, setCanInstall] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)

  useEffect(() => {
    // Check if already installed
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                         window.navigator.standalone === true

    if (isStandalone) {
      setIsInstalled(true)
      return
    }

    // Check if user has dismissed the prompt recently
    const dismissedAt = localStorage.getItem('roam_pwa_dismissed')
    if (dismissedAt) {
      const dismissedTime = parseInt(dismissedAt, 10)
      const oneWeek = 7 * 24 * 60 * 60 * 1000
      if (Date.now() - dismissedTime < oneWeek) {
        return // Don't show for a week after dismissal
      }
    }

    // Listen for the beforeinstallprompt event
    const handleBeforeInstallPrompt = (e) => {
      // Prevent Chrome 67 and earlier from automatically showing the prompt
      e.preventDefault()
      // Stash the event so it can be triggered later
      setDeferredPrompt(e)
      setCanInstall(true)
    }

    // Listen for app installed event
    const handleAppInstalled = () => {
      setDeferredPrompt(null)
      setCanInstall(false)
      setIsInstalled(true)
      localStorage.removeItem('roam_pwa_dismissed')
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const installApp = async () => {
    if (!deferredPrompt) return false

    // Show the install prompt
    deferredPrompt.prompt()

    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice

    // Clear the deferred prompt
    setDeferredPrompt(null)
    setCanInstall(false)

    return outcome === 'accepted'
  }

  const dismissPrompt = () => {
    setCanInstall(false)
    localStorage.setItem('roam_pwa_dismissed', Date.now().toString())
  }

  return {
    canInstall,
    isInstalled,
    installApp,
    dismissPrompt
  }
}

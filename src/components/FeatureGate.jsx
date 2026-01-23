import { useState, useCallback, cloneElement, isValidElement } from 'react'
import { useSubscription } from '../hooks/useSubscription'
import UpgradePrompt from './UpgradePrompt'

/**
 * FeatureGate - Wrapper component to gate premium features
 *
 * Usage:
 * <FeatureGate
 *   feature="saves"
 *   currentCount={savedPlaces.length}
 *   onAllowed={() => savePlace(place)}
 * >
 *   <button>Save Place</button>
 * </FeatureGate>
 *
 * Or with render prop:
 * <FeatureGate feature="saves" currentCount={5}>
 *   {({ isAllowed, onAction }) => (
 *     <button onClick={onAction}>Save</button>
 *   )}
 * </FeatureGate>
 */
export default function FeatureGate({
  feature,
  currentCount = 0,
  onAllowed,
  children
}) {
  const { hasFeature, hasReachedLimit, features } = useSubscription()
  const [showPrompt, setShowPrompt] = useState(false)

  // Map feature names to limit names and prompt types
  const featureConfig = {
    saves: { limit: 'saveLimit', promptType: 'saves' },
    collections: { limit: 'collectionLimit', promptType: 'collections' },
    offline: { limit: null, promptType: 'offline' },
    export: { limit: null, promptType: 'export' },
    advancedFilters: { limit: null, promptType: 'filters' }
  }

  const config = featureConfig[feature] || { limit: null, promptType: feature }

  // Check if action is allowed
  const isAllowed = config.limit
    ? !hasReachedLimit(config.limit, currentCount)
    : hasFeature(feature)

  // Handle action attempt
  const handleAction = useCallback((e) => {
    if (isAllowed) {
      onAllowed?.(e)
    } else {
      setShowPrompt(true)
    }
  }, [isAllowed, onAllowed])

  // Close prompt
  const handleClosePrompt = useCallback(() => {
    setShowPrompt(false)
  }, [])

  // Handle successful upgrade
  const handleUpgrade = useCallback(() => {
    setShowPrompt(false)
    // After upgrade, the action should work - retry it
    onAllowed?.()
  }, [onAllowed])

  // Render prop pattern
  if (typeof children === 'function') {
    return (
      <>
        {children({
          isAllowed,
          onAction: handleAction,
          limit: features[config.limit],
          remaining: config.limit
            ? Math.max(0, features[config.limit] - currentCount)
            : null
        })}
        <UpgradePrompt
          type={config.promptType}
          isOpen={showPrompt}
          onClose={handleClosePrompt}
          onUpgrade={handleUpgrade}
        />
      </>
    )
  }

  // Clone children and attach onClick handler
  if (isValidElement(children)) {
    const child = cloneElement(children, {
      onClick: (e) => {
        handleAction(e)
        children.props.onClick?.(e)
      }
    })

    return (
      <>
        {child}
        <UpgradePrompt
          type={config.promptType}
          isOpen={showPrompt}
          onClose={handleClosePrompt}
          onUpgrade={handleUpgrade}
        />
      </>
    )
  }

  return children
}

/**
 * Hook for programmatic feature gating
 */
export function useFeatureGate(feature) {
  const { hasFeature, hasReachedLimit, features } = useSubscription()
  const [showPrompt, setShowPrompt] = useState(false)

  const featureConfig = {
    saves: { limit: 'saveLimit', promptType: 'saves' },
    collections: { limit: 'collectionLimit', promptType: 'collections' },
    offline: { limit: null, promptType: 'offline' },
    export: { limit: null, promptType: 'export' },
    advancedFilters: { limit: null, promptType: 'filters' }
  }

  const config = featureConfig[feature] || { limit: null, promptType: feature }

  const checkAccess = useCallback((currentCount = 0) => {
    const allowed = config.limit
      ? !hasReachedLimit(config.limit, currentCount)
      : hasFeature(feature)

    if (!allowed) {
      setShowPrompt(true)
    }

    return allowed
  }, [config.limit, feature, hasFeature, hasReachedLimit])

  const closePrompt = useCallback(() => {
    setShowPrompt(false)
  }, [])

  return {
    checkAccess,
    showPrompt,
    closePrompt,
    promptType: config.promptType,
    limit: features[config.limit],
    isUnlimited: hasFeature(feature)
  }
}

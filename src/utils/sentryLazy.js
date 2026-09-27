// Only the Sentry pieces errorReporting.js uses. It dynamic-imports this file
// rather than '@sentry/react' itself so the lazy chunk stays tree-shaken.
export {
  init, setUser, addBreadcrumb, captureException, captureMessage,
  browserTracingIntegration, replayIntegration,
} from '@sentry/react'

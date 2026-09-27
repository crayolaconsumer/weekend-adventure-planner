/**
 * AdminStatus: the one loading / error / empty block for admin pages.
 * Renders children when there is nothing to report.
 */
export default function AdminStatus({ loading, error, empty, emptyTitle = 'Nothing here yet', emptyText, onRetry, children }) {
  if (loading) {
    return (
      <div className="admin-status" role="status">
        <span className="admin-spinner" aria-hidden="true" />
        Loading…
      </div>
    )
  }
  if (error) {
    return (
      <div className="admin-status admin-status-error" role="alert">
        <strong>Couldn't load this</strong>
        <span>{error}. Check your connection and try again.</span>
        {onRetry && <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>Try again</button>}
      </div>
    )
  }
  if (empty) {
    return (
      <div className="admin-status">
        <strong>{emptyTitle}</strong>
        {emptyText && <span>{emptyText}</span>}
      </div>
    )
  }
  return children
}

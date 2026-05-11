/**
 * NotFound — the canonical 404 page.
 *
 * Used by the catch-all route AND by AdminRoute when a non-admin lands
 * on /admin/*. The two paths render identical markup so route
 * discovery via DOM diffing is foreclosed.
 */
export default function NotFound() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      padding: '2rem',
      textAlign: 'center'
    }}>
      <h1 style={{ fontSize: '4rem', margin: '0 0 1rem', opacity: 0.3 }}>404</h1>
      <p style={{ fontSize: '1.1rem', marginBottom: '1.5rem', opacity: 0.7 }}>Page not found</p>
      <a href="/" style={{
        padding: '0.75rem 1.5rem',
        background: 'var(--color-primary, #007AFF)',
        color: 'white',
        borderRadius: '8px',
        textDecoration: 'none',
        fontWeight: '500'
      }}>Back to Discover</a>
    </div>
  )
}

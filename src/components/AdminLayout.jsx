/**
 * AdminLayout
 *
 * Shared chrome for every page under /admin/*. Provides:
 *   - "← Back to dashboard" link in the top bar (hidden on /admin itself)
 *   - Breadcrumb (Admin / <title>) on every sub-page
 *   - Page title + optional subtitle
 *   - Optional actions slot at the top-right (refresh buttons, filters, etc.)
 *
 * Used by AdminDashboard, AdminReports, AdminCampaigns, AdminUsers,
 * AdminAds, AdminActivity. Sub-pages render their content inside
 * <AdminLayout>...</AdminLayout> — the wrapper handles all the
 * cross-page navigation furniture.
 */

import { Link, useLocation } from 'react-router-dom'
import './AdminLayout.css'

export default function AdminLayout({
  title,
  subtitle = null,
  actions = null,
  children,
}) {
  const { pathname } = useLocation()
  const isDashboard = pathname === '/admin'

  return (
    <div className="admin-layout">
      <div className="admin-layout-topbar">
        {!isDashboard ? (
          <Link to="/admin" className="admin-layout-back" aria-label="Back to admin dashboard">
            <span aria-hidden="true">←</span> Back to dashboard
          </Link>
        ) : (
          <span className="admin-layout-back-placeholder" aria-hidden="true" />
        )}
        {actions && <div className="admin-layout-actions">{actions}</div>}
      </div>

      <header className="admin-layout-header">
        {!isDashboard && (
          <nav className="admin-layout-breadcrumb" aria-label="Breadcrumb">
            <Link to="/admin">Admin</Link>
            <span aria-hidden="true"> / </span>
            <span className="admin-layout-breadcrumb-current">{title}</span>
          </nav>
        )}
        <h1 className="admin-layout-title">{title}</h1>
        {subtitle && <p className="admin-layout-subtitle">{subtitle}</p>}
      </header>

      <main className="admin-layout-content">{children}</main>
    </div>
  )
}

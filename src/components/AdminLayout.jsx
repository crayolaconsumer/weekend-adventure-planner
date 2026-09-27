/**
 * AdminLayout
 *
 * Shared chrome for every page under /admin/*: a sidebar on desktop
 * (scrolling tab strip on phones) linking every admin tool, the page
 * title (also set as the document title), an optional subtitle and an
 * optional actions slot. Pages render their content as children.
 */

import { useEffect } from 'react'
import { NavLink, Link } from 'react-router-dom'
import './AdminLayout.css'

const NAV = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/reports', label: 'Reports' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/campaigns', label: 'Campaigns' },
  { to: '/admin/promoted-events', label: 'Promoted events' },
  { to: '/admin/ads', label: 'Ad analytics' },
  { to: '/admin/activity', label: 'Audit log' },
]

export default function AdminLayout({ title, subtitle = null, actions = null, children }) {
  useEffect(() => {
    const prev = document.title
    document.title = `${title} · ROAM admin`
    return () => { document.title = prev }
  }, [title])

  return (
    <div className="admin-layout">
      <aside className="admin-layout-side">
        <Link to="/admin" className="admin-layout-brand">
          <img src="/icons/icon.svg" alt="" width="28" height="28" />
          <span>ROAM <em>admin</em></span>
        </Link>
        <nav className="admin-layout-nav" aria-label="Admin">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `admin-layout-navlink${isActive ? ' active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <Link to="/" className="admin-layout-exit">Back to the app</Link>
      </aside>

      <div className="admin-layout-body">
        <header className="admin-layout-header">
          <div className="admin-layout-heading">
            <h1 className="admin-layout-title">{title}</h1>
            {subtitle && <p className="admin-layout-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="admin-layout-actions">{actions}</div>}
        </header>
        <div className="admin-layout-content">{children}</div>
      </div>
    </div>
  )
}

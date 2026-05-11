/**
 * AdminRoute
 *
 * Route guard that renders <NotFound /> for non-admin visitors BEFORE
 * touching the lazy-loaded admin component. Means:
 *   - The admin chunk never appears in the network tab for non-admins
 *     (so attackers can't infer the route exists from JS bundle traffic).
 *   - The URL stays at /admin/reports but the rendered HTML is byte-
 *     identical to what /random-nonexistent-route would render.
 *   - Auth checks happen client-side here for UX, but the API is the
 *     real gate — this component is advisory only.
 *
 * While auth is loading we render NotFound rather than a spinner so a
 * non-admin tabbing in has no perceptible difference from a real 404.
 * Admins re-render once auth resolves.
 */

import { useAuth } from '../contexts/AuthContext'
import NotFound from '../pages/NotFound'

export default function AdminRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) return <NotFound />
  if (!user?.isAdmin) return <NotFound />

  return children
}

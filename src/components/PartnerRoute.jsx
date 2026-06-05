/**
 * PartnerRoute
 *
 * Gate for the self-serve partner portal. The portal is WEB-ONLY — it must
 * never appear inside the native iOS/Android apps (App Store / Play policy:
 * we don't sell ad campaigns through the app binary). On native we render
 * <NotFound /> before the lazy chunk loads, mirroring AdminRoute.
 *
 * Auth and "do you have a partner account yet" states are handled inside the
 * portal pages themselves (so a logged-out visitor still sees the landing /
 * sign-in), not here.
 */

import { isNative } from '../utils/nativeBridge'
import NotFound from '../pages/NotFound'

export default function PartnerRoute({ children }) {
  if (isNative()) return <NotFound />
  return children
}

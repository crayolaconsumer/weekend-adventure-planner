// Entry paths people reach from a shared link. On the web, a first-time
// visitor landing here sees the content before onboarding (see App.jsx).
const SHARED_LINK = /^\/(place|user|plan\/share)\//
// Info pages a visitor may open from a shared page (e.g. Terms from sign-up);
// onboarding waits through these too
const INFO_PAGE = /^\/(terms|privacy|support|pricing|get-roam)(\/|$)/

/** Should onboarding stay deferred on this path? */
export function keepDeferring(pathname) {
  return SHARED_LINK.test(pathname) || INFO_PAGE.test(pathname)
}

/** First-time web visitor who arrived on a shared link: show content first. */
export function shouldDeferOnboarding({ onboarded, native, pathname }) {
  return !onboarded && !native && SHARED_LINK.test(pathname)
}

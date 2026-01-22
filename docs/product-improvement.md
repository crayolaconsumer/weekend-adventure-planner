# ROAM Product Improvement Document

Last updated: 2026-01-22

Purpose
Define a detailed, actionable set of improvements (UX, accessibility, product depth, visual polish)
to move ROAM toward a best-in-class discovery experience. This is designed to guide engineering
and design implementation work.

Scope and Method
- Scope: Frontend React app in `src/` and associated CSS.
- Method: Static code review only (no runtime QA, no device testing).
- Note: All findings should be validated in live QA (mobile + desktop, keyboard-only, screen reader).

Goals
- Remove blockers for conversion and sharing.
- Make core flows accessible and robust on mobile and desktop.
- Strengthen the "why it matters" narrative and social proof.
- Deliver a product feel that is distinctive, premium, and addictive.

Non-goals
- Backend schema changes (unless required for shareable routes or social proof).
- Full redesign; this is a structured evolution of current design language.

------------------------------------------------------------------------------
Executive Summary (Top Issues)

P0 Blockers
1) Auth modal is not openable from critical triggers (sign-up prompt and voting).
   Evidence: `src/components/ContributionPrompt.jsx#L77`, `src/components/ContributionDisplay.jsx#L66`,
   no listener in `src/App.jsx#L92`.
2) Share links go to `/place/:id` but no route exists; shared links 404.
   Evidence: `src/components/ShareButton.jsx#L56`, routes in `src/App.jsx#L206`.
3) "Go now" uses `window.open` after a timeout, likely blocked by popup blockers.
   Evidence: `src/components/SwipeCard.jsx#L193`, `src/components/CardStack.jsx#L107`.
4) Core surfaces are mouse/touch only (no keyboard access).
   Evidence: `src/components/SwipeCard.jsx#L247`, `src/components/EventCard.jsx#L58`,
   `src/pages/Events.jsx#L920`.
5) Modals lack focus trapping and dialog semantics.
   Evidence: `src/components/AuthModal.jsx#L214`, `src/components/PlaceDetail.jsx#L180`,
   `src/components/EventDetail.jsx#L190`.

P1 High Value
1) Discover settings toggles hide native inputs, breaking keyboard and screen reader access.
   Evidence: `src/pages/Discover.css#L343`.
2) Icon-only buttons missing `aria-label` (multiple locations).
   Evidence: `src/App.jsx#L85`, `src/components/EventDetail.jsx#L237`,
   `src/components/ShareButton.jsx#L141`, `src/pages/Wishlist.jsx#L261`,
   `src/components/Toast.jsx#L59`.
3) Form fields rely on placeholders instead of labels.
   Evidence: `src/components/ContributionPrompt.jsx#L120`, `src/components/VisitedPrompt.jsx#L396`.
4) Tabs and filters lack ARIA state (screen reader clarity).
   Evidence: `src/pages/Activity.jsx#L28`, `src/pages/UserProfile.jsx#L165`,
   `src/pages/Events.jsx#L612`, `src/pages/Discover.jsx#L510`.
5) Toasts are not announced via `aria-live`.
   Evidence: `src/components/Toast.jsx#L67`.

P2 Strategic Enhancements
1) Surface "why it matters" (top tip + trusted contributor) in the core card UI.
2) Add map/list toggle and "Adventure Mode" to better use desktop space.
3) Stronger taste profiling + social proof loop inside Discover.

------------------------------------------------------------------------------
Detailed Findings and Recommendations

1) Conversion and Growth Blockers (P0)

1.1 Auth modal cannot be opened from core triggers
- Problem: Sign-up prompt and vote actions dispatch `openAuthModal`, but nothing listens.
- Evidence:
  - `src/components/ContributionPrompt.jsx#L77` dispatches event.
  - `src/components/ContributionDisplay.jsx#L66` dispatches event.
  - No `addEventListener` in `src/App.jsx` or elsewhere.
- Impact: Account creation funnel breaks at the moment of intent.
- Recommendation:
  - Add a global listener in `App.jsx` to call `openAuthModal()`.
  - Or pass `onOpenAuth` callback to components instead of custom events.
- Acceptance criteria:
  - Clicking "Sign Up Free" opens AuthModal.
  - Upvoting when logged out opens AuthModal.

1.2 Share links are invalid
- Problem: Share button links to `/place/:id` but route does not exist.
- Evidence:
  - `src/components/ShareButton.jsx#L56` builds share URL.
  - `src/App.jsx#L206` routes do not include `/place/:id`.
- Impact: Shared links 404; viral sharing loop fails.
- Recommendation:
  - Add `/place/:id` route that fetches/enriches place and renders PlaceDetail.
  - Consider serverless OG endpoint for rich previews.
- Acceptance criteria:
  - Opening shared link renders a PlaceDetail view.
  - Link works on mobile, desktop, and social previews.

1.3 "Go now" blocked by popup blockers
- Problem: `window.open` invoked after a timeout is often blocked (Safari/Chrome).
- Evidence:
  - `src/components/SwipeCard.jsx#L193` and `src/components/CardStack.jsx#L107`.
- Impact: Primary CTA feels broken or inconsistent.
- Recommendation:
  - Call `window.open` synchronously in the click handler.
  - Or render a direct `<a target="_blank">` for the action.
- Acceptance criteria:
  - "Go now" opens Maps reliably on iOS Safari and Android Chrome.

------------------------------------------------------------------------------
2) Accessibility and Interaction (P0/P1)

2.1 Core interactive surfaces are not keyboard accessible
- Problem: Cards and grid items are clickable divs without keyboard handlers.
- Evidence:
  - `src/components/SwipeCard.jsx#L247` is `motion.div` with onClick.
  - `src/components/EventCard.jsx#L58` uses `motion.div` with onClick.
  - `src/pages/Events.jsx#L920` uses a clickable `div`.
- Impact: Keyboard-only users cannot open details.
- Recommendation:
  - Convert to `<button>` or `<a>` where appropriate.
  - If div must remain, add `role="button"`, `tabIndex=0`, and key handlers.
- Acceptance criteria:
  - Cards can be activated with Enter/Space.
  - Screen readers announce them as actionable.

2.2 Modals lack focus trapping and dialog semantics
- Problem: Overlays open without `role="dialog"` and without trapping focus.
- Evidence:
  - `src/components/AuthModal.jsx#L214`
  - `src/components/PlaceDetail.jsx#L180`
  - `src/components/EventDetail.jsx#L190`
  - `src/components/CollectionManager.jsx#L92`
- Impact: Focus escapes; confusing for keyboard + screen reader users.
- Recommendation:
  - Add `role="dialog"`, `aria-modal="true"`, and a focus trap.
  - Set initial focus to the modal title or first input.
- Acceptance criteria:
  - Tab/Shift+Tab stays inside modal.
  - Escape closes modal.

2.3 Discover settings toggles are inaccessible
- Problem: checkbox inputs are `display: none`.
- Evidence: `src/pages/Discover.css#L343`.
- Impact: No keyboard focus, screen readers may not detect.
- Recommendation:
  - Use visually hidden inputs instead of `display: none`.
  - Add `role="switch"` and `aria-checked` as needed.
- Acceptance criteria:
  - Toggles are keyboard focusable.
  - Screen reader announces "switch" and state.

2.4 Icon-only buttons lack labels
- Evidence:
  - Location banner close: `src/App.jsx#L85`
  - Event detail close: `src/components/EventDetail.jsx#L237`
  - Share menu close: `src/components/ShareButton.jsx#L141`
  - Wishlist remove: `src/pages/Wishlist.jsx#L261`
  - Toast close: `src/components/Toast.jsx#L59`
- Impact: Screen readers announce only "button".
- Recommendation: Add `aria-label` to every icon-only button.
- Acceptance criteria: Screen reader announces descriptive action.

2.5 Form fields rely on placeholders (no labels)
- Evidence:
  - `src/components/ContributionPrompt.jsx#L120`
  - `src/components/VisitedPrompt.jsx#L396`
  - `src/components/VisitedPrompt.jsx#L445`
- Impact: Poor accessibility and form clarity.
- Recommendation:
  - Add visible `<label>` or `aria-label`.
  - Consider helper text for long-form prompts.

2.6 Tabs/filters lack ARIA state
- Evidence:
  - `src/pages/Activity.jsx#L28`
  - `src/pages/UserProfile.jsx#L165`
  - `src/pages/Events.jsx#L612`
  - `src/pages/Discover.jsx#L510`
- Impact: Screen readers cannot identify selected state.
- Recommendation:
  - Use `role="tablist"` and `role="tab"` with `aria-selected`.
  - For filter chips, use `aria-pressed`.

2.7 Toasts are not announced
- Evidence: Toast container in `src/components/Toast.jsx#L67`.
- Impact: Users may miss feedback (save, errors).
- Recommendation:
  - Add `role="status"` and `aria-live="polite"` to toast container.
  - Add `aria-label` to close button.

------------------------------------------------------------------------------
3) Mobile UX Review

Strengths
- Strong visual identity and motion.
- Good safe-area handling and stable viewport variable.
- Boredom Buster is a compelling, immersive moment.

Concerns
- Bottom nav text size is very small on mobile (`0.65rem`).
  Evidence: `src/index.css#L786`.
  Impact: readability and tap confidence, especially outdoors.
- Some buttons rely on icon only (no labels).
- Settings and filters are one layer too hidden for rapid tuning.

Recommendations
- Increase nav label size to 0.75-0.8rem and add hover/focus states.
- Promote a one-tap filter “drawer” on Discover.
- Add “Change location” affordance in top header when fallback location is used.

------------------------------------------------------------------------------
4) Desktop UX Review

Concerns
- Desktop still feels like a mobile-only app (single card stack, narrow columns).
- No map/list duality; no usage of width for context.
- Card-based discovery is slower with mouse than a mixed grid + map.

Recommendations
- Add a split layout on desktop: left card, right map or list.
- Enable “Grid view” for Discover (similar to Events grid).
- Add keyboard shortcuts for swipe actions (left/right/up).

------------------------------------------------------------------------------
5) Visual / Hierarchy Opportunities

Observations
- The app’s aesthetic is strong, but the “why” narrative is buried.
- Too many equal-weight elements; the tip/social proof should dominate.
- The “I’m Bored” button is powerful; use it as the brand hero.

Recommendations
- Place top community tip as a quote under the place name (with contributor).
- Add a small “trusted explorer” badge for top contributors.
- Convert key actions to a single, confident CTA for each screen.

------------------------------------------------------------------------------
6) Feature Gaps and Shortcomings

Sharing
- No functional deep link route.
- No OG/meta previews for social shares.
- No “Copy link” feedback in system UI (toast or inline).

Community
- Tips exist but not leveraged to influence discovery.
- No flagging/reporting for bad tips (moderation).
- No contributor reputation surfaced.

Discovery
- No manual location override when geolocation fails.
- Filters are hidden and not sticky enough for quick scanning.

Events
- If APIs are missing, the fallback message is dev‑focused, not user‑focused.
- No clear “near me” context on cards beyond location line.

------------------------------------------------------------------------------
Implementation Plan

Phase 1: P0 Fixes (1-2 days)
- Add global `openAuthModal` handler in `App.jsx`.
- Add `/place/:id` route and load PlaceDetail from ID.
- Make map opening synchronous to user gesture.
- Make SwipeCard, EventCard, and Events grid keyboard‑accessible.
- Add dialog semantics + focus trapping to all modals.

Phase 2: P1 A11y and UX (2-4 days)
- Fix Discover toggle input accessibility.
- Add `aria-label` for all icon-only buttons.
- Add labels to textareas in Contribution and Visited prompts.
- Add ARIA roles for tabs and filter chips.
- Add `aria-live` to toasts.

Phase 3: P2 Strategic Enhancements (1-2 sprints)
- Surface top community tip and social proof in Discover cards.
- Add map/list toggle and “Adventure Mode” route builder.
- Build taste profile and show “Because you liked X” signals.
- Add location override in the Discover header.

------------------------------------------------------------------------------
Acceptance Criteria (Definition of Done)

P0
- Auth modal opens from sign-up prompts and voting actions.
- Shared place links resolve and render a place detail view.
- "Go now" opens Maps reliably on iOS and Android.
- Swipe cards and event cards are keyboard-activatable.
- All modals trap focus and announce as dialogs.

P1
- Discover toggles are focusable and correctly announce state.
- All icon-only buttons have descriptive labels.
- Form fields are labeled; placeholders are supplementary only.
- Tabs announce selected state.
- Toasts are announced via screen readers.

P2
- Discover cards show a top tip with contributor.
- Map/list toggle is available on desktop.
- Taste‑based personalization is visible in UI copy.
- Location override is available when geo fails.

------------------------------------------------------------------------------
QA Checklist (Minimum)

Mobile (iOS Safari / Android Chrome)
- "Go now" opens Maps.
- Swipe actions work; tap opens details.
- Auth modal opens from prompts.
- Close buttons are tappable with proper labels.
- Boredom Buster works without layout overflow.

Desktop (Chrome / Safari / Firefox)
- Keyboard-only navigation works through cards and modals.
- Tabs announce state (screen reader).
- Modals trap focus.
- Events grid is keyboard accessible.

Screen Reader (VoiceOver / NVDA)
- Modals are announced with labels.
- Tabs announce selection.
- Toggle switches announce state.
- Toast messages are announced.

------------------------------------------------------------------------------
Metrics to Track
- Activation: % completing onboarding and first save.
- Conversion: auth prompt -> account created.
- Engagement: swipe-to-detail open rate; "Go now" success rate.
- Social: share rate and share link open rate.
- Retention: D1/D7 after first adventure.

------------------------------------------------------------------------------
Notes
This document reflects a static review. Validate each issue with runtime testing
and user observation before finalizing scope. The design system is strong; the
biggest wins now are removing funnel blockers and elevating the community voice.

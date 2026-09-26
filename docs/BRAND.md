# ROAM brand guide

How a new screen, page or email should look so it plainly belongs to ROAM.
Everything here already exists in the code; the source is named for each item.
When in doubt, copy an existing screen (Discover, Wishlist, the town pages) rather than invent.

## Voice

- Tagline: **Stop scrolling. Start roaming.** Use it as-is.
- Plain, warm, short. Sentence case everywhere, including buttons ("Explore", "Get started").
- Say what a button does: "Download on the App Store", not "Learn more".
- Errors say what happened and what to do next ("Check your connection and try again"). No apologies.
- Empty states invite an action rather than state an absence.

## Logo

The compass rose: forest disc, gold ring, gold north point, cream E/S/W points.

| Where | Use |
|---|---|
| Web and server-rendered pages | `<img src="/icons/icon.svg">` (`public/icons/icon.svg`) |
| React | `CompassMark` in `src/components/Onboarding.jsx` (inline copy of the same SVG) |
| App icon / PWA | `public/icons/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` |

Wordmark: **ROAM** in Newsreader 400, `letter-spacing: -0.04em`, forest (`.discover-wordmark` in `src/pages/Discover.css`).
Logo + wordmark side by side is the header lockup for any standalone page (see the town pages).

## Colour

Tokens live in `src/index.css`. Always use the token, never a new hex.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--roam-forest` | `#1a3a2f` | `#6ea58a` | Primary brand, titles, selected chips |
| `--roam-terracotta` / `-light` | `#c45c3e` / `#e07a5f` | same | Accent, "I'm Bored" button |
| `--roam-sage` | `#87a28e` | same | Nature, tag pills (22% tint) |
| `--roam-gold` | `#d4a855` | same | Highlights, compass, focus rings |
| `--roam-cream` | `#faf8f5` | `#0d1b16` | Page background |
| `--roam-paper` | `#f7f3ed` | `#142822` | Chips, sections |
| `--roam-parchment` | `#ede7dc` | `#1f3a30` | Borders, dividers |
| `--color-surface-elevated` | `#ffffff` | `#1f3a30` | Cards |
| `--roam-ink` / `-light` / `-muted` | `#2a2520` / `#4a443d` / `#8a847c` | `#f4ecdc` / `#d0c5b0` / `#8a8275` | Text |

Dark theme is `[data-theme="dark"]` in the app. Outside the app use `@media (prefers-color-scheme: dark)` with the same values.

**Forest buttons with white text use the literal `#1a3a2f`**, because `--roam-forest` lightens in dark mode and white text on it becomes unreadable (see `GetRoam.css`, `.town-search button`).

Category colours come from `CategoryIcon` (`src/components/icons/CategoryIcon.jsx`): food terracotta, nature sage, culture plum, historic umber, entertainment coral, nightlife indigo, active blue, shopping violet.

## Type

| Role | Font | Notes |
|---|---|---|
| Display: titles, wordmark, section headings | Newsreader (`--font-display`) | 400 for big titles with `-0.04em` tracking, 500 for section headings |
| Body, UI, buttons | Outfit (`--font-body`) | 400 body, 500 chips, 600 buttons and names |
| | | Buttons and inputs inherit the page font via a global rule in `src/index.css`; don't set a system font on them |

Scale (`src/index.css`): `--text-xs` 0.75 / `sm` 0.875 / `base` 1 / `lg` 1.125 / `xl` 1.375 / `2xl` 1.75 / `3xl` 2.25 / `4xl` 3 / `hero` 4 rem.
In-app page titles use `.page-title` sizing: `--text-2xl`, weight 500, ink (Saved, Social, town screens). Forest `--text-hero` is reserved for the Discover wordmark; public web landing pages may go up to `--text-3xl`.
Place and event names on cards are Newsreader 500 at `--text-lg`, like the Events and Discover cards.
Tags are sentence case ("Historic house"), never `text-transform: capitalize`.

## Shape and depth

- Radius: cards `--radius-lg` (16px), CTA panels `--radius-xl` (24px), buttons/chips/inputs `--radius-full`.
- Shadows are soft and warm: `--shadow-sm` on cards and pills, `--shadow-md` on hover. No hard or grey shadows.
- Spacing: `--space-*` scale (0.25 / 0.5 / 1 / 1.5 / 2 / 3 / 4 rem). Pages are a single centred column, max ~640–680px, 16px side padding.

## Reuse these, don't rebuild them

| Need | Use |
|---|---|
| Filter / tag chips | global `.chip` and `.chip.selected` (`src/index.css`); Wishlist and TownPage show the pattern |
| Category badge | `CategoryIcon` (`<CategoryIcon name="food" size="sm" />`) |
| Category from an OSM type | `getCategoryForType(type)` (`src/utils/categories.ts`) |
| Place photo with branded fallback | `PlaceImage`, and pass `categoryKey` so a missing photo shows the category gradient instead of blank |
| Place details sheet | `PlaceDetail` |
| Loading | `LoadingState` (`variant="spinner"` or `"skeleton"`) |
| Error / empty block | `.place-page-error` markup (`src/pages/Place.css`) |
| Row that links somewhere | `.town-near` card (icon disc + title + one-line hint + chevron), `src/pages/TownPage.css` |
| Back button | 40px round, 8% forest tint, arrow icon (`.collections-back-btn`, `.town-back`); never a text "← Back" |
| Horizontal filter row | one row that scrolls sideways (Events date chips, `.town-filters`); don't let filters wrap |
| Share | `shareContent()` (`src/utils/shareCard.js`) with `getPublicShareUrl()` so links point at go-roam.uk |
| Icons | inline stroke SVGs, 2px stroke, round caps (see `src/pages/Discover/icons.jsx`) |

## Pages outside the React app

Server-rendered pages (e.g. `api/town.js`) can't import React components. They:

1. Declare the same `--roam-*` tokens and dark values in their own `<style>` (see `api/lib/towns.js`).
2. Use `/icons/icon.svg` for the logo.
3. Use CategoryIcon medallions pre-rendered into `api/lib/brandSvgs.js`. After changing `CategoryIcon`, regenerate with
   `UPDATE_BRAND_SVGS=1 npx vitest run tests/unit/api/brandSvgs.test.jsx` (the same test fails if they drift).
4. Load Newsreader and Outfit from Google Fonts.

## Checklist for anything new

- [ ] Background is cream (`--roam-cream`), cards are elevated white with a parchment border.
- [ ] Page title is `.page-title` (Newsreader 500, `--text-2xl`, ink); body in Outfit ink.
- [ ] Chips are `.chip`; filter rows scroll on one line; category visuals are `CategoryIcon`; no emoji as icons.
- [ ] Icon-only controls are round 40px buttons; text buttons pair an icon with the label.
- [ ] Buttons are pills; primary is forest (literal hex under white text in light theme, the lighter dark-theme forest in dark), accent is terracotta.
- [ ] Works in dark theme and at 390px wide, with a visible keyboard focus.
- [ ] Copy is sentence case, active, and says what happens.
- [ ] Standalone pages carry the compass + wordmark header and a route back into the app.

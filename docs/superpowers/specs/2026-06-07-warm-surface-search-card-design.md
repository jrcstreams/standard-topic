# Warm off-white surface — home search card + takeover modals

**Date:** 2026-06-07
**Status:** Approved (John: warm cream #faf8f5; apply to home search card + ALL takeover modals; match home card width to the search modal)

## Goal

Give the homepage search hero a contained off-white card, share that color across
all takeover modals, and match the home card's width to the search modal — so
clicking the homepage search visually "lifts" into the modal with no width/color
jump. The search panel component is already shared (`renderSearchPanel`,
mode `inline` on home / `modal` in the takeover), which makes the continuity clean.

## Design

### Tokens (single source of the color)
Add to `:root`:
- `--color-surface: #faf8f5` (warm off-white card/modal surface)
- `--color-surface-border: #efe9e0` (hairline/divider on that surface)

### 1. Home search hero → card
- `.home-search-hero` becomes a centered card: `max-width: 600px` (exactly the
  search modal's `.takeover-panel` width), `margin: 0 auto`, `background:
  var(--color-surface)`, `border: 1px solid var(--color-surface-border)`,
  `border-radius: 16px`, and a soft shadow lighter than the modal's
  (`0 2px 10px -4px rgba(15,23,42,.10)` — it rests on the page, doesn't float).
- The inline search bar already centers at `min(560px,100%)`; inside the 600px
  card with padding it reads full-width, matching how the bar fills the modal.
- Add an inner padding wrapper class so the card padding is independent of the
  panel internals (one wrapper div in `app.js` around the inline panel, or style
  `.home-search-hero` directly — prefer styling `.home-search-hero` to avoid JS).

### 2. All takeover modals → warm surface
- `.takeover-panel { background: #fff }` → `var(--color-surface)`.
- `.search-page-panel { background: #fff }` → `var(--color-surface)` (it overrode
  the base).
- Internal hairlines that assumed a white panel shift to the warm border so they
  read on cream:
  - `.search-panel--modal .search-panel-hero { border-bottom: #eef0f4 }` →
    `var(--color-surface-border)`.
  - `.search-modal-head { border-bottom: #eef0f4 }` → `var(--color-surface-border)`.
  - Audit other `takeover-*` headers/footers with `#eef0f4`/`#fff` dividers and
    move them to the token (Trends/Topics/Settings/Discover modal heads).

### 3. Inner elements stay white (depth, not mud)
- Search input resting background → `#fff` (already white on focus) so it reads as
  a white well on the cream surface.
- Suggestion rows, result cards, model pickers already use white/`--color-bg`; no
  change needed beyond verifying contrast on cream.

### Scope guardrail
Only `.takeover-*` panels and `.home-search-hero` change color. Page background,
sidebars, news feed, topic cards stay as-is — the cream specifically signals
"search/modal surface," not a sitewide repaint.

## Non-changes
- No JS/structure changes to the search flow; `renderSearchPanel` untouched.
- Cache-bust `css/styles.css` (`?v=`); bump `app.js` only if a wrapper class is
  added there.

## Testing
- Playwright on the real site at desktop + mobile widths: home search card is
  centered at 600px on cream; open the search modal and confirm the modal width +
  color match the card (the "lift" continuity); open Trends/Topics/Settings modals
  and confirm cream surface with legible dividers and white inner wells.
- Restore viewport / unroute after.

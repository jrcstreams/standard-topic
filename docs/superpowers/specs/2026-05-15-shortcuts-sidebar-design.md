# AI Shortcuts Sidebar + Sticky Scrollable Cards — Design Spec

**Date:** 2026-05-15
**Status:** Approved — ready for implementation plan
**Scope:** Home, Topic, and Custom-search page layouts
**Files touched:** `js/app.js`, `js/components/newsfeed.js`, `css/styles.css`

---

## Goal

Convert the AI Shortcuts section from a stacked, multi-column grid into a sticky left sidebar on desktop, alongside the News Feed. Both cards get internal scrolling with pinned headers, multi-select controls that don't float, and scroll-affordance indicators (fade + chevron) at the top/bottom of each scrollable region.

On narrow viewports (<900px), AI Shortcuts stacks on top of News Feed as it does today, but the same sticky-header + internal-scroll + single-column treatment applies inside the card.

---

## Layout grid

`.topic-layout` is the only structural change. It becomes responsive at `900px`:

| Viewport | Layout |
|----------|--------|
| `<900px` | Single column. Shortcuts card on top, News Feed below. |
| `≥900px` | Two columns: `grid-template-columns: 320px minmax(0, 1fr); gap: 1.5rem`. Shortcuts in left column, News Feed in right. |

Custom-search pages keep their single-column `.topic-layout.is-custom` (no News Feed). Shortcuts card spans full width but receives the same internal-scroll/sticky/fade treatment as topic pages, so the look is consistent. The custom-search shortcut grid currently goes 2-col at desktop — that's removed in favor of the single-column sidebar style. (Confirmed acceptable; revisit later if needed.)

---

## AI Shortcuts card

### Structure

The card contains three vertically stacked regions:

```
┌─ .shortcuts-sidebar ─────────────┐
│ .sidebar-card-header     [pin]   │  Title + multi-toggle
├──────────────────────────────────┤
│ .shortcuts-multi-submit-wrap     │  Submit / Clear / Select All
│       (only when multi is on)    │  Inline, NOT floating sticky
├──────────────────────────────────┤
│ .shortcuts-list-wrap             │
│   .shortcuts-scroll-fade-top     │  Conditional ↑ fade + chevron
│   .sidebar-shortcut-list         │  Single-column, overflow-y: auto
│   .shortcuts-scroll-fade-bottom  │  Conditional ↓ fade + chevron
└──────────────────────────────────┘
```

### Sticky behavior

**Desktop (≥900px):**
- The card itself is `position: sticky; top: calc(var(--subnav-height) + 12px)`. As News Feed scrolls past, the card stays pinned.
- `max-height: calc(100vh - var(--subnav-height) - 32px)`. Card never exceeds viewport.
- Card is flex column: header (auto), multi-controls (auto, only when multi-on), list-wrap (`flex: 1; min-height: 0`).
- List-wrap has `overflow-y: auto` — when shortcuts overflow, they scroll inside; header and multi-controls remain visible at the top of the card.

**Mobile (<900px):**
- Card is NOT page-sticky (it's the top stacked section; sticky has no meaning there).
- `max-height: min(70vh, 600px)` so it doesn't dominate the page. List scrolls internally if it overflows.
- Header and multi-controls pin to the top of the card via inner `position: sticky; top: 0`.

### Multi-select submit/clear controls placement

When multi-select is on, `.shortcuts-multi-submit-wrap` becomes a normal block sitting **above** the scrollable list (below the header). This replaces the current bottom-sticky overlay. Reasons:
- No floating UI competing for space with scroll affordances.
- Always visible whether the list is scrolled to top or bottom.
- The existing `.shortcuts-multi-submit-sentinel` and `IntersectionObserver`-based `is-stuck` styling become unused — remove them.

The wrap stays inside the card and stays compact (single row on desktop; wraps to 2 rows on mobile if buttons don't fit, same as today).

### Single-column shortcut buttons (sidebar + mobile)

The 1/2/3/4-column responsive grid (640/880/1140 breakpoints) is removed. `.sidebar-shortcut-list` is always single column. Button sizing tuned for ~290px content width:

| Property         | Current   | New      |
|------------------|-----------|----------|
| Icon size        | 22-24px   | **18px** |
| Button padding   | 0.7rem × 1rem | **0.55rem × 0.75rem** |
| Title font-size  | 0.95rem   | **0.875rem** |
| Title font-weight| 600       | **500** |
| Title line-height| 1.3       | **1.25** |
| Title overflow   | wrap      | **`white-space: nowrap; text-overflow: ellipsis; overflow: hidden`** |
| Chevron size     | 14px      | **12px**, muted color |
| Row gap          | 0.5rem    | **0.25rem** |

Truncated titles get a `title` attribute for hover tooltip. User will shorten long titles separately as they review; ellipsis is the fallback, not the primary state.

### "View More Shortcuts" toggle — removed

Internal-scroll makes the collapse-with-peek behavior obsolete. The entire `is-collapsible`/`is-collapsed` system, per-breakpoint nth-child peek rules (lines ~1675-1750 of styles.css), and the View More button (`.shortcuts-view-toggle`) are removed. The list always shows all shortcuts; users scroll within the card to see more.

The `canCollapse` logic and related state in `renderShortcutsSidebar` (`app.js:765-845`) is removed alongside.

---

## News Feed card

### Structure

```
┌─ .newsfeed-card ─────────────────┐
│ .newsfeed-scroll-wrap            │
│   ┌─ .newsfeed-card-header [pin]┐│  Sticky to top of wrap (top: 0)
│   │  "News Feed" title           ││
│   └──────────────────────────────┘│
│   .newsfeed-scroll-fade-top      │  Conditional ↑ fade + chevron
│   .newsfeed-embed > iframe       │  Natural tall height set by postMessage
│   .newsfeed-scroll-fade-bottom   │  Conditional ↓ fade + chevron
└──────────────────────────────────┘
```

The header sits **inside** the scroll wrap, not above it, so iframe content visibly scrolls *behind* it as the wrap scrolls.

### Sticky behavior

Symmetric with the shortcuts card.

**Desktop (≥900px):**
- Card is `position: sticky; top: calc(var(--subnav-height) + 12px)`. Stays in viewport while page scrolls.
- Card `max-height: calc(100vh - var(--subnav-height) - 32px); overflow: hidden`.
- `.newsfeed-scroll-wrap` fills the card (`height: 100%`) and is `overflow-y: auto`.
- `.newsfeed-card-header` inside the wrap is `position: sticky; top: 0; z-index: 2; background: <card-bg>`. Iframe content scrolls behind it.

**Mobile (<900px):**
- Card is NOT page-sticky (stacked below shortcuts; sticky is moot).
- Card `max-height: min(70vh, 700px); overflow: hidden`.
- Same internal sticky-header structure inside the wrap.

### Iframe height

No change needed. `rss-embed.html` already sets `body { overflow: hidden }` and posts `body.scrollHeight` to the parent via `postMessage`. `newsfeed.js:89-93` then sets the iframe's `style.height` to that value, so the iframe naturally renders all items at full height. Wrapping it in our scroll container just means our wrap scrolls instead of the iframe — no rss.app behavior is affected, no items are lost.

### Fade overlay positioning (news feed)

Because the sticky header occupies the top of the wrap, the top fade overlay needs to sit *below* the header:

- Top fade: `position: sticky; top: var(--newsfeed-header-h); pointer-events: none` — sticks just below the sticky header.
- Bottom fade: `position: sticky; bottom: 0; pointer-events: none`.
- Both have a fixed height (~28px) and z-index above the iframe but below the header.

`--newsfeed-header-h` is read from the header's `offsetHeight` once after render and stored as a CSS custom property on the wrap.

---

## Scroll affordance indicators (fade + chevron)

Reusable pattern applied to both `.shortcuts-list-wrap` and `.newsfeed-scroll-wrap`.

### Visual

- Top overlay: absolute-positioned, full width, ~28px tall, gradient `linear-gradient(to bottom, white 30%, transparent)`, ↑ chevron icon centered horizontally near the top edge.
- Bottom overlay: mirror — `linear-gradient(to top, white 30%, transparent)`, ↓ chevron near the bottom edge.
- Chevron: 14px stroke icon, color `var(--color-text-muted)`, with a 2s ease-in-out infinite bobbing animation (translateY ±2px). `prefers-reduced-motion: reduce` disables the animation.
- Overlays are `pointer-events: none` so clicks/scrolls pass through to the content.

### State

Scroll wrapper element gets two boolean state classes that drive overlay visibility:

- `.has-overflow-top` — set when `scrollTop > 0`
- `.has-overflow-bottom` — set when `scrollTop + clientHeight < scrollHeight - 1`

Both classes are toggled by a rAF-throttled `scroll` listener attached to the wrapper. Initial computation runs after render (in a `requestAnimationFrame`) and again on `resize`. A `ResizeObserver` on the wrapper handles content-size changes (e.g., multi-controls appearing).

Follows the existing pattern at `css/styles.css:3441-3479` (`.quick-links-scrollwrap.has-overflow-left/right`).

---

## Sticky offset coordination

The codebase already maintains `--subnav-height` as a CSS custom property (`app.js:69`, updated via `setSubnavHeightVar` and observed via ResizeObserver on the subnav). All new sticky positions and max-heights reference this variable so they auto-adjust when the subnav's Content Shortcuts row collapses on scroll.

No new global scroll listeners are added beyond the per-wrapper scroll handlers for fade indicators.

---

## Files and changes

### `js/app.js`
- `renderShortcutsSidebar` (lines ~758-955):
  - Remove `canCollapse`, `is-collapsible`, `is-collapsed`, View More button rendering.
  - Remove `multiExpandedCard` collapse coordination in the multi-toggle handler.
  - Move `.shortcuts-multi-submit-wrap` to render **above** `.shortcuts-list-wrap` (currently below).
  - Remove `.shortcuts-multi-submit-sentinel` and its IntersectionObserver.
  - Add scroll-fade overlay markup (`.shortcuts-scroll-fade-top`, `.shortcuts-scroll-fade-bottom`) inside `.shortcuts-list-wrap`.
  - Add scroll listener (rAF-throttled) on `.sidebar-shortcut-list` (or the wrap, whichever is the scroller) that toggles `has-overflow-top` / `has-overflow-bottom` classes.
- `renderTopicLayout` (lines ~664-700): no markup change needed (layout is CSS-driven).

### `js/components/newsfeed.js`
- Restructure markup so `.newsfeed-card-header` moves **inside** a new `.newsfeed-scroll-wrap` (it currently sits as a sibling of `.newsfeed-embed`).
- Wrap the iframe + the header in `.newsfeed-scroll-wrap` along with the top/bottom fade overlay elements.
- Iframe height handling stays as-is — keep the `message` listener that sets `iframe.style.height` from `rssHeight`. No fixed height. The iframe is just very tall inside our scroll wrap.
- Add scroll listener (rAF-throttled) on `.newsfeed-scroll-wrap` toggling `has-overflow-top` / `has-overflow-bottom`.
- After first render, measure `.newsfeed-card-header.offsetHeight` and set it as `--newsfeed-header-h` on the wrap (used by top fade `top:` value).

### `css/styles.css`
- Update `.topic-layout` grid: `@media (min-width: 900px) { grid-template-columns: 320px minmax(0, 1fr); }`. Custom variant stays single column.
- **Delete** the orphaned `is-split` / `is-home-split` / `.panel-shortcuts` / `.panel-related` / `.panel-newsfeed` rules (lines ~3322-3362). They aren't referenced by current JS (verified via grep) — leftover from a prior layout iteration.
- Add sticky/max-height/flex-column rules on `.shortcuts-sidebar` (desktop) and max-height-only on mobile.
- Add a `max-width: 480px; margin: 0 auto` on `.shortcuts-sidebar` inside `.topic-layout.is-custom` so custom-search pages get a centered, readable card instead of a 1200px-wide single-column button list. (Visual consistency stop-gap; user noted this page may be revisited.)
- Restyle `.sidebar-shortcut` per the sizing table.
- Remove the 1/2/3/4-column grid rules for `.sidebar-shortcut-list` and the per-breakpoint nth-child peek rules (lines ~1675-1750).
- Remove `.shortcuts-view-toggle` rules and `.shortcuts-multi-submit-sentinel` rules.
- Add `.newsfeed-card` desktop sticky + max-height rules and mobile max-height rules.
- Add `.newsfeed-scroll-wrap` rules: `height: 100%; overflow-y: auto; position: relative`.
- Add `.newsfeed-card-header { position: sticky; top: 0; background: <card-bg>; z-index: 2; }`.
- Add shared scroll-fade overlay rules (`.shortcuts-scroll-fade-top/-bottom`, `.newsfeed-scroll-fade-top/-bottom`). News-feed top-fade uses `top: var(--newsfeed-header-h)`.
- Add chevron bob keyframes + `prefers-reduced-motion` guard.

---

## Out of scope

- Sticky on mobile shortcuts card (the card is at the page top; making it page-sticky there has no value).
- Persistent collapsed state across page navigations (the collapse system is removed entirely).
- rss.app postMessage handshake for true iframe scroll state.
- Updating the custom-search page beyond the shared single-column sidebar styling (revisit later if needed).
- Changes to the prompt generator, about, terms, or 404 pages.

---

## Acceptance checks

1. At ≥900px viewport: Shortcuts card is a left sidebar; News Feed is the right column. Sidebar stays sticky when scrolling.
2. Long shortcut lists scroll **inside** the card on both desktop and mobile, with title and multi-controls pinned at the top.
3. With multi-select on, submit/clear/select-all controls sit above the list (not floating at the bottom), and never go offscreen as the list scrolls.
4. Top and bottom fade + chevron overlays appear in both the shortcuts list and the news feed scroll wrapper when there's hidden content in that direction; disappear when at the edge.
5. Mobile layout: single column, shortcuts card on top with internal scroll behavior; news feed below with same.
6. Custom search page: shortcuts use the same single-column card style as topic pages.
7. No regression to subnav, search modal, prompt builder, or other page types.
8. `prefers-reduced-motion: reduce` disables the chevron bob animation.

# Unified Takeover Modals + Search Modal — Design

**Date:** 2026-06-03
**Status:** Approved

## Summary

Make the four main-nav actions — **Search**, **Trends**, **Topics**, **Settings** —
open in a consistent "takeover" modal: full-screen on mobile, a large
centered card (~960px) on desktop, with responsive multi-column content
where it helps. Convert **Custom Topic Search** from its own page
(`#/custom/{term}`) into a **Search modal** with two states (empty → centered
hero + search; filled → search pinned top, intelligence accordions below).
`#/custom/{term}` URLs are preserved as deep-links that open the modal
prefilled.

## Decisions

| Decision | Choice |
|---|---|
| Scope | All four nav takeovers + multi-column + Search modal, one pass (internally incremental) |
| Magnifier "Search" button | Opens the new **Custom Search modal** (Topics button keeps opening the topic picker) |
| `#/custom/{term}` | Kept as deep-links that open the Search modal prefilled (filled state); the standalone page is removed |
| Desktop shell | Large centered card `min(960px, 94vw)`, not literal full-screen |
| Empty-state copy | Headline "News, Resources and AI Knowledge. On any topic." + subtext "Type any topic and we'll build out web sources, AI shortcuts, and analysis tools tailored to it." |

## Architecture

### 1. Shared takeover shell — `css/styles.css` (`.takeover-*`)

A reusable shell (CSS class set) the four modals adopt so they look/behave
the same:
- **Overlay:** dim + blur, fixed.
- **Panel:**
  - Mobile (≤640px): full-screen (`inset: 0`, no radius).
  - Desktop: centered card, `width: min(960px, 94vw)`, `max-height: 88vh`,
    rounded, shadow.
  - Flex column: fixed header (title + ✕) + scrollable body.
- **Body modifier `.takeover-body--cols`:** CSS grid, `1fr` on mobile →
  `repeat(2, 1fr)` at ≥720px, for the multi-column layouts.

The existing search-overlay (Topics picker) is migrated onto these classes;
Settings + Trends panels adopt them too.

### 2. Search modal (Custom Search reborn) — `js/components/search-page-modal.js` (new)

To "keep all the content that is in the Custom Topic Search page," the
filled state **reuses the existing custom-search content rendering** — the
same `renderShortcutsSidebar(container, route, isHome=false, isCustom=true,
customTerm=term)` the page uses today (Web Sources / Discover / Learn /
Analyze accordions + the multi-select rows + the Review & Submit bar). It's
relocated into the modal body, not rebuilt, so behavior is preserved.

- `initSearchPageModal()` builds overlay + panel (takeover shell), listens
  for `open-search-modal` (detail: `{ term?: string }`).
- **Empty state** (`term` empty): a centered hero column — headline +
  subtext + a prominent search input (`.search-page-hero`).
- **Filled state** (term present): the search input pins to the top of the
  body; below it, `renderShortcutsSidebar(...)` renders the term's
  intelligence. The accordion group (`.ti-accordions`) is laid out
  **2-column at ≥720px**, single column on mobile.
- Submitting a term (Enter) transitions empty → filled (re-render with the
  term), sets `#/custom/{encodeURIComponent(term)}` (shareable), and renders
  the content. Clearing returns to the empty state and resets the hash to the
  opener's route (or `#/`). Live topic-match suggestions are out of scope
  this pass — any submitted term builds its intelligence.

### 3. Routing — `js/utils/router.js` + `js/app.js`

- `#/custom/{term}` no longer renders a page. Instead, on entering that
  route, the app opens the Search modal prefilled with `{term}` and renders
  the *underlying* page as the home layout (so closing the modal leaves the
  user on home, not a blank route). Closing the modal navigates to `#/`.
- The magnifier `#nav-search` dispatches `open-search-modal` (empty).
- The topic picker's "type your own / custom" CTA opens the Search modal
  (and sets `#/custom/{term}`).
- The `renderTopicLayout` `isCustom` branch + `renderCustomSearchBar` +
  custom-sticky code are removed (superseded by the modal).

### 4. Topics picker — widen + 2 columns — `css/styles.css` (+ minor `search-modal.js`)

- `.search-overlay-card` adopts the takeover shell (≤640 full-screen, desktop
  `min(960px, 94vw)`).
- The browse grid (`renderBrowseSection`) becomes a **2-column** topic-card
  grid at ≥720px (single column on mobile). Search field stays pinned at the
  top of the body.

### 5. Trends modal — takeover shell + 2-column list — `trending-list-modal.js` + CSS

- `.tlm-panel` adopts the takeover shell sizing (full-screen mobile, ~960
  desktop).
- On desktop the trending list renders in **2 columns**
  (`.takeover-body--cols` or a 2-col list), still opening the trending detail
  modal on click. The detail modal stacks above as today; its "← Trending"
  back link still returns to the list.

### 6. Settings modal — takeover shell + 2 columns — `settings-modal.js` + CSS

- The settings panel adopts the takeover shell.
- Desktop body becomes **2 columns**: Default-model grid in one column,
  Reasoning level + Custom instructions in the other (single column on
  mobile). No behavior change — purely layout.

## Data flow

```
nav 🔍 Search  → open-search-modal({})            → empty hero
nav ⊞ Topics   → openSearchOverlay()               → topic picker (2-col desk)
nav ↗ Trends   → open-trending-list                → trending list (2-col desk)
nav ⚙ Settings → open-settings-modal               → settings (2-col desk)
#/custom/{term}→ open-search-modal({term})         → filled (accordions)
search submit  → set #/custom/{term} + render accordions
```

## Testing

- Manual (mocked data) across mobile (≤640) + desktop (≥1024):
  - Each nav action opens its takeover; mobile = full-screen, desktop =
    centered ~960 card.
  - Topics/Search/Trends/Settings show 2 columns on desktop, 1 on mobile.
  - Search empty → type term → filled (search top, accordions); `#/custom/{term}`
    set; reload of `#/custom/{term}` opens prefilled; clear → empty + hash reset.
  - Topic sidebar + trending detail accordions still render (shared builders
    unaffected).
- Brace-balance + `node --check` on every touched file.

## Out of scope (this pass)

- Redesigning *what's inside* the Search modal beyond the empty/filled states
  + current accordions (user will iterate later).
- Live topic-match suggestions inside the Search modal.
- Changing the trending detail / prompt / review modals.

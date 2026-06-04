# Inline Search Hero + Expanding Search Panel — Design

**Date:** 2026-06-03
**Status:** Approved

## Summary

Phase 13 reworks topic search into a single **expanding search panel** used on two
surfaces:

1. **Homepage inline hero** — the homepage becomes a normal scrolling page with a
   search hero ("News, Resources and AI Knowledge. On any topic." + subtext + pill
   search bar) at the top, above the existing News Feed / Topic Intelligence / Trending
   content. Searching a free-text term expands the term's intelligence accordions *in
   place* (no separate modal screen).
2. **Nav-magnifier modal** — keeps the takeover modal, but instead of hard-swapping
   empty→filled it now **smoothly expands** the same panel.

Both surfaces share one renderer, collapse the hero on expand, and show **live
topic-match suggestions** as you type.

## Decisions

| Decision | Choice |
|---|---|
| Homepage search submit | Expands **inline** on the page (no separate modal from home) |
| Hero on expand | Headline + subtext **fade/collapse away**; search bar rises, accordions get the space |
| Desktop homepage | Becomes a **normal scrolling page** (home opts out of `app-mode`) |
| Search routing | Homepage inline search is **ephemeral** (URL stays `#/`); a **"Copy link"** button copies `…/#/custom/{term}` after a search. Modal keeps `#/search` + `#/custom/{term}`. Nav magnifier always opens the modal. |
| Modal | Reuses the shared panel and **smoothly expands** on submit (no hard re-render) |
| Live topic suggestions | In **both** search bars; clicking a matched topic → `#/topic/{slug}` (full page); a "Search '{term}' →" row + Enter on free text → custom-intelligence expand |
| Mobile homepage | Search hero on first load; **one-way fade-out** as the tab bar goes sticky on scroll (gone until refresh / nav magnifier) |
| Accordion internals | **Unchanged** |
| Topic-page layout | **Unchanged** (only home changes) |

## Architecture

### 1. Shared `renderSearchPanel(container, opts)` — `js/app.js`

A single function drives both surfaces. `opts = { mode: 'inline' | 'modal', term =
'' }`.

Responsibilities:
- Render the **hero**: headline + subtext + a `.search-panel-form` (search input with
  magnifier icon). `mode:'modal'` adds the ✕ close chip; `mode:'inline'` omits it.
- Render a **suggestions dropdown** under the input (hidden until typing).
- Manage two visual states on one element:
  - **collapsed** — hero visible, no accordions.
  - **expanded** — headline + subtext collapsed (`max-height`→0 + opacity→0), search
    bar pinned to top, `.search-panel-results` revealed with a height + opacity
    transition. The results host is populated via the existing
    `renderShortcutsSidebar(results, { type:'custom', term, tab:'shortcuts' }, false,
    true, term)`.
- Expanded controls: **Copy link** (writes `location.origin + location.pathname +
  '#/custom/' + encodeURIComponent(term)` to the clipboard, with a transient
  "Copied" confirmation) and **✕ / New search** (collapse back to the hero, clear the
  input).

The modal shell (Phase 12 `openSearchPageModal` / `renderSearchModalBody`) is
refactored to call `renderSearchPanel(panelBody, { mode:'modal', term })` instead of
its bespoke empty/filled markup. The smooth expand replaces the old swap: the modal
panel grows as the accordions reveal (CSS height/opacity transition on
`.search-panel-results` + collapsing `.search-panel-hero-copy`).

### 2. Live topic-match suggestions

Reuses `searchTopics(query)` (already imported in `app.js` and used by the Topics
picker). On each input event (debounced ~120ms):
- Query `searchTopics(value.trim())`; render up to ~6 matches as a list under the
  input (`.search-panel-suggest`), each a button with the topic name + parent.
- Always include a trailing **"Search '{term}' →"** row that triggers the
  free-text custom expand.
- Click a topic row → `navigate('#/topic/{slug}')` (closes the modal if in modal
  mode; on inline home it leaves the hero and loads the topic page).
- Enter with the list open and a row highlighted → that row's action; Enter with no
  highlight → free-text custom expand for the typed term.
- Empty input → hide the dropdown.

Keyboard: ↑/↓ move highlight, Enter selects, Esc closes the dropdown (a second Esc in
modal mode closes the modal). This mirrors the existing picker's behavior.

### 3. Homepage restructure — `renderTopicLayout` (home branch) + `renderLayout`

- The home route **opts out of `app-mode`** (mirrors how the old custom page scrolled)
  so the page scrolls naturally. The body gets a `home-search` class so CSS can target
  the new layout without affecting topic pages.
- `#content` for home renders, top-to-bottom:
  1. `<div class="home-search-hero">` — hosts `renderSearchPanel(_, { mode:'inline' })`.
  2. The existing `.topic-layout` block (body tabs + trending + shortcuts + newsfeed),
     unchanged, now flowing below the hero.
- Desktop: hero spans full content width at top; the two-column News Feed / Topic
  Intelligence layout sits below and scrolls. Inline expansion pushes that content
  further down.
- The hero search input reuses the same `renderSearchPanel` inline instance — its
  suggestions and expand behave identically to the modal.

### 4. Mobile homepage scroll/fade

- The body-tabs row (`News Feed / Trending / Topic Intelligence`) becomes **sticky**
  under the nav on mobile (CSS `position: sticky; top: var(--subnav-height)`).
- A scroll listener (mobile + home only) maps `scrollY` over the hero's height to the
  hero's opacity/translate so it **fades and lifts** as you scroll toward the tabs.
- Once `scrollY` passes a threshold (hero scrolled out), the hero is **hidden and
  latched** (a `heroDismissed` flag) so scrolling back up does **not** restore it —
  one-way until a reload. Searching before scrolling expands inline (and suppresses the
  fade while expanded).
- To search again after dismissal: reload, or the nav magnifier (modal). Desktop has
  **no** fade — the hero stays at the top and the page scrolls normally.

### 5. Routing

- Unchanged: `#/` (home), `#/search` (empty modal), `#/custom/{term}` (modal,
  prefilled + expanded), `#/topic/{slug}`.
- The homepage inline search does **not** change the route. The **Copy link** button is
  the only path from inline search to a shareable `#/custom/{term}` URL (which, when
  opened, opens the modal as today).
- Nav magnifier `#nav-search` → `navigate('#/search')` (opens the modal) on every page,
  including home.
- **Modal submit still updates the URL** to `#/custom/{term}` (so it stays shareable and
  back-button works), but the route handler must detect that the modal is already open
  and **expand the existing panel in place** rather than rebuilding it — otherwise the
  smooth expand would be replaced by a hard re-render. (Phase 12's `lastBaseRouteKey`
  guard already prevents re-rendering the home base; the modal needs the analogous guard
  so `openSearchPageModal` expands rather than re-renders when the panel is live.)

## Data flow

```
home #/                → renderSearchPanel(inline) hero  +  News Feed / TI below
  type term            → suggestions dropdown (searchTopics)
    click topic        → #/topic/{slug}
    "Search 'term' →"  → expand accordions inline (hero collapses) + Copy-link shown
nav 🔍                 → #/search → modal → renderSearchPanel(modal), expands on submit
#/custom/{term}        → modal, prefilled + expanded
mobile home scroll     → tabs sticky, hero fades + latches dismissed (one-way)
```

## Testing

Playwright at 1280 + 390 (fresh context + `Network.setCacheDisabled`; bump the
`styles.css?v=` cache-bust):
- Desktop home: hero renders at top; News Feed / TI pushed below; page scrolls.
- Inline free-text search expands accordions, collapses hero; Copy link writes
  `…/#/custom/{term}`; ✕ collapses back.
- Suggestions: typing a known topic shows it; clicking → `#/topic/{slug}`; "Search
  'term' →" expands custom intelligence; works in both hero and modal.
- Modal: submit expands smoothly (no flash/re-render); `#/custom/{term}` deep-link
  opens prefilled + expanded.
- Mobile home: hero visible on load; scrolling sticks the tab bar and fades the hero;
  scrolling back up does NOT restore it; nav magnifier still opens the modal.
- `node --check js/app.js`; CSS brace balance; `node tools/test_trending_normalize.mjs`.

## Out of scope

- Accordion internals (rows, grouping, multi-select submit bar) — unchanged.
- Topic-page layout — unchanged.
- Persisting the inline search across navigation or restoring the dismissed mobile hero
  without a reload.

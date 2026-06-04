# Takeover Modals + Search Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. UI/CSS-heavy — "tests" are scoped browser checks (Playwright) + `node --check` + CSS brace balance.

**Goal:** Make Search/Trends/Topics/Settings open as a consistent takeover modal (full-screen mobile, ~960px desktop card, 2-column where useful), and convert Custom Search from a page into a stateful Search modal (empty hero → filled), with `#/custom/{term}` preserved as deep-links.

**Architecture:** A shared `.takeover-*` CSS shell adopted by all four modal panels. The Search modal is managed in `app.js` (so it can call `renderShortcutsSidebar` directly for the filled state — same content the page used). Routing: `#/custom/{term}` opens the Search modal prefilled over the home layout; the page render is removed.

**Tech Stack:** Vanilla JS ES modules, CSS, Playwright checks.

Spec: `docs/superpowers/specs/2026-06-03-takeover-modals-search-modal-design.md`

---

### Task 1: Shared takeover shell CSS

**Files:** Modify `css/styles.css` (append a `.takeover-*` block).

- [ ] **Step 1:** Append shell classes: overlay (dim+blur, z-index 160), panel (desktop centered `min(960px,94vw)` × `max-height:88vh`, rounded; ≤640px full-screen `inset:0` no radius), header (title + ✕, sticky), body (scroll), and `.takeover-body--cols` (grid `1fr`, `repeat(2,1fr)` at ≥720px with gap). Include `.is-in` pop-in transition. Full CSS provided at implement time.
- [ ] **Step 2:** Brace balance check: `node -e "const c=require('fs').readFileSync('css/styles.css','utf8');process.exit((c.match(/{/g)||[]).length===(c.match(/}/g)||[]).length?0:1)"`.
- [ ] **Step 3:** Commit `git add -A && git commit -m "Add shared takeover modal shell CSS"`.

---

### Task 2: Search modal — shell + empty state (app.js)

**Files:** Modify `js/app.js` (add `initSearchPageModal`, `openSearchPageModal`, `closeSearchPageModal`; call init in DOMContentLoaded).

- [ ] **Step 1:** Add module-scoped `searchModalEl` + an `initSearchPageModal()` that creates `<div class="takeover-overlay search-page-overlay">` + panel with header (✕ + title "Search") + body. Listen for `open-search-modal` (detail `{ term }`). Overlay click + Esc close.
- [ ] **Step 2:** `openSearchPageModal(term='')` shows the shell, calls `renderSearchModalBody(term)`, adds `.is-in`, sets `body.style.overflow='hidden'`.
- [ ] **Step 3:** `renderSearchModalBody(term)`: if no term → **empty hero**:
  ```html
  <div class="search-page-hero">
    <h2 class="search-page-hero-title">News, Resources and AI Knowledge.<br>On any topic.</h2>
    <p class="search-page-hero-sub">Type any topic and we'll build out web sources, AI shortcuts, and analysis tools tailored to it.</p>
    <form class="search-page-form" id="search-page-form">
      <span class="search-page-input-icon">🔍svg</span>
      <input class="search-page-input" id="search-page-input" type="search" placeholder="Search any topic…" autocomplete="off">
      <button type="button" class="search-page-clear" hidden>✕</button>
    </form>
  </div>
  ```
  Wire submit (Enter): trimmed term → `submitSearchTerm(term)`.
- [ ] **Step 4:** `node --check js/app.js`. Browser: magnifier wiring done in Task 4; for now verify `window.dispatchEvent(new CustomEvent('open-search-modal',{detail:{}}))` in console shows the hero.
- [ ] **Step 5:** Commit.

---

### Task 3: Search modal — filled state + submit/clear + hash

**Files:** Modify `js/app.js`.

- [ ] **Step 1:** `renderSearchModalBody(term)` filled branch (term present): render the input pinned at top (same `.search-page-form` but in a `.search-page-top` bar, prefilled with term + a visible clear button), then a `<div class="search-page-results"></div>`. Call `renderShortcutsSidebar(resultsEl, { type:'custom', term, tab:'shortcuts' }, false, true, term)` to populate the term's intelligence (Web Sources/Discover/Learn/Analyze + multi-select). Add class `.takeover-body--cols` is NOT used here (the accordions get 2-col via a scoped rule in Task 8).
- [ ] **Step 2:** `submitSearchTerm(term)`: `currentSearchTerm = term`; `renderSearchModalBody(term)`; `setHashSilently('#/custom/' + encodeURIComponent(term))` (update URL without triggering a full re-render — see note). Clear button → `submitSearchTerm('')` back to hero + reset hash to the opener route.
- [ ] **Step 2a (hash without re-render):** Add a guard so the modal-driven hash change doesn't re-run the page render: when `openSearchPageModal` set the hash, set a flag `suppressNextRouteRender` that the route handler checks and skips. (The route handler already re-renders on hashchange; we suppress when the change came from the modal.)
- [ ] **Step 3:** `node --check js/app.js`. Commit.

---

### Task 4: Routing — #/custom opens the modal; magnifier opens it; remove page

**Files:** Modify `js/app.js` (route dispatch), `js/components/search-modal.js` (picker custom CTA already navigates `#/custom/...` — keep).

- [ ] **Step 1:** In the route dispatch (around line 2152, `if (route.type === 'custom')`), replace the `renderTopicLayout(...isCustom...)` call with: render the **home** layout (`renderTopicLayout(content, { topic: getTopicBySlug('home'), route: { type:'home', slug:'home', tab:'newsfeed' }, isHome:true })`) then `openSearchPageModal(decodeURIComponent(route.term))`. Guard against re-opening if already open with the same term.
- [ ] **Step 2:** Wire the magnifier: change `document.getElementById('nav-search')` handler from `openSearchOverlay({focusInput:true})` to `window.dispatchEvent(new CustomEvent('open-search-modal',{detail:{}}))`.
- [ ] **Step 3:** `closeSearchPageModal()` → hide shell, `body.overflow=''`, and if the hash is `#/custom/...`, `navigate('#/')` (suppressing the modal re-open).
- [ ] **Step 4:** Remove now-dead custom-page code: the `isCustom` branch in `renderTopicLayout` (the `.custom-search-head` / sticky markup), `renderCustomSearchBar`, `setupCustomStickyBar`, and the `body.custom-mode` add (lines ~167-169). Keep `renderShortcutsSidebar`'s `isCustom` path (used by the modal).
- [ ] **Step 5:** `node --check js/app.js`. Browser: magnifier → hero; type "tesla" + Enter → filled with accordions, hash `#/custom/tesla`; reload `#/custom/tesla` → opens prefilled; close → `#/`. Commit.

---

### Task 5: Topics picker — takeover shell + 2-column grid

**Files:** Modify `css/styles.css` (+ confirm `search-modal.js` browse markup).

- [ ] **Step 1:** `.search-overlay-card` desktop width → `min(960px, 94vw)`; ≤640px full-screen (inset 0, radius 0). The browse topic grid (`.search-overlay-browse` / topic cards) → CSS grid `repeat(2, 1fr)` at ≥720px, 1 column below. (Inspect the exact browse container class at implement time and target it.)
- [ ] **Step 2:** Brace check. Browser: open Topics (nav) at 1280 → 2 columns; at 390 → full-screen 1 column. Commit.

---

### Task 6: Trends modal — takeover shell + 2-column list

**Files:** Modify `css/styles.css` (`.tlm-*`).

- [ ] **Step 1:** `.tlm-panel` adopts the takeover sizing (≤640 full-screen; desktop `min(720px, 94vw)` — a bit narrower than 960 since it's a list, but wider than today's 430). The trending list (`.trending-scroll` / list) → 2-column on desktop via `.tlm-body .trending-list { columns / grid }` (use CSS `grid-template-columns: repeat(2,1fr)` on the `ul` at ≥720px). Verify the scroll-fade still works (or drop the fade when not scrolling).
- [ ] **Step 2:** Brace check. Browser: nav Trends at 1280 → wider, 2-column list; click item → detail stacks; mobile full-screen. Commit.

---

### Task 7: Settings modal — takeover shell + 2-column

**Files:** Modify `css/styles.css` (`.settings-modal-*`).

- [ ] **Step 1:** `.settings-modal` panel adopts the takeover shell (≤640 full-screen; desktop `min(760px, 94vw)`). Desktop body → 2-column: the Default-model section in column 1, Reasoning + Custom-instructions in column 2 (use a grid on the body container; inspect the settings section wrappers at implement time). Single column ≤720px.
- [ ] **Step 2:** Brace check. Browser: nav Settings at 1280 → 2-column; 390 → full-screen 1-column; save/cancel still work. Commit.

---

### Task 8: Search-modal accordion 2-column + polish

**Files:** Modify `css/styles.css`.

- [ ] **Step 1:** In the filled Search modal, lay the accordion group 2-column on desktop: `.search-page-results .ti-accordions { display:grid; grid-template-columns:1fr; gap:.6rem; } @media(min-width:720px){ .search-page-results .ti-accordions{ grid-template-columns:repeat(2,1fr) } }`. Ensure the multi-select submission bar (`.shortcuts-multi-submit-wrap`) positions sensibly inside the modal (it's absolute in the sidebar — re-anchor to the modal bottom or make it static within the results). Style the hero (`.search-page-hero*`) + top bar (`.search-page-top`).
- [ ] **Step 2:** Brace check. Browser: filled Search modal at 1280 → 2-column accordions; submit bar usable; 390 → 1 column. Commit.

---

### Task 9: Full verification + deploy

- [ ] **Step 1:** Playwright pass at 390 + 1280: each of the four nav actions opens its takeover (mobile full-screen, desktop centered ~960/720/760 + columns). Search empty→filled→clear + `#/custom` deep-link + close→`#/`. Topic sidebar + trending detail accordions still render (shared builders).
- [ ] **Step 2:** `node --check` all touched JS; CSS brace balance; `node tools/test_trending_normalize.mjs` still passes.
- [ ] **Step 3:** Commit outstanding; `git push origin main`. Verify live.

---

## Notes
- The Search modal lives in `app.js` to reuse `renderShortcutsSidebar` (avoids exporting it / circular imports). app.js grows, but that matches the existing pattern (the modals/layout already live there).
- `setHashSilently` / `suppressNextRouteRender`: the app re-renders on `hashchange`; the modal must update the URL for shareability without tearing down the home layout underneath. A one-shot suppress flag is the minimal mechanism.
- Keep the topic-picker overlay (`search-modal.js`) intact for Topics; only restyle it. The magnifier stops using it (now opens the Search modal).

# Inline Search Hero + Expanding Search Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **UI/CSS-heavy:** there is no JS unit-test harness in this repo — "tests" are scoped Playwright browser checks + `node --check js/app.js` + CSS brace balance (`node -e "const c=require('fs').readFileSync('css/styles.css','utf8');process.exit((c.match(/{/g)||[]).length===(c.match(/}/g)||[]).length?0:1)"`). Playwright must use a fresh CDP session with `Network.setCacheDisabled` and load `index.html?cb=N` to dodge stale CSS.

**Goal:** Turn topic search into one expanding search panel used on two surfaces — a homepage inline hero (homepage becomes a scrolling page) and the nav-magnifier modal — both with a smooth collapse-hero/expand-accordions animation and live topic-match suggestions.

**Architecture:** A single `renderSearchPanel(container, { mode, term })` in `js/app.js` renders the hero + search bar + suggestions + results host and owns the expand animation. The Phase 12 modal is refactored to use it; the homepage adds an inline instance and opts out of `app-mode` so it scrolls. CSS animates the hero collapse and results reveal via the `grid-template-rows: 1fr→0fr / 0fr→1fr` technique.

**Tech Stack:** Vanilla JS ES modules, CSS, Playwright checks.

Spec: `docs/superpowers/specs/2026-06-03-inline-search-hero-expanding-panel-design.md`

Key existing symbols (in `js/app.js` unless noted): `SEARCH_ICON_SVG`, `X_ICON_SVG`, `openSearchPageModal`, `closeSearchPageModal`, `isSearchModalOpen`, `userCloseSearchModal`, `initSearchPageModal`, `renderSearchModalBody` (to be removed), `wireSearchModal` (to be removed), `searchModalOverlay`, `searchModalPanel`, `searchModalTerm`, `lastBaseRouteKey`, `renderShortcutsSidebar(container, route, isHome, isCustom, customTerm)`, `escapeAttr`, `navigate`, `renderTopicLayout`. From `data.js`: `searchTopics(query)` → `[{ slug, name, parentName, ... }]`. From `router.js`: `getCurrentRoute()`.

---

### Task 1: Search-panel shell CSS + expand animation

**Files:** Modify `css/styles.css` (append a `.search-panel-*` block). Modify `index.html:83` (bump `?v=`).

- [ ] **Step 1:** Append the panel CSS. The hero and results use the `grid-template-rows` trick so height animates smoothly; `[data-state="expanded"]` collapses the hero and reveals the results.

```css

/* === Expanding search panel (homepage hero + nav modal) ============== */
.search-panel { position: relative; display: flex; flex-direction: column; width: 100%; }
.search-panel-close { position: absolute; top: 0.2rem; right: 0.2rem; z-index: 3; }

/* Hero (headline + subtext) — collapses on expand. */
.search-panel-hero {
  display: grid; grid-template-rows: 1fr; opacity: 1;
  text-align: center; transition: grid-template-rows 0.32s ease, opacity 0.24s ease, margin 0.32s ease;
}
.search-panel-hero > * { overflow: hidden; min-height: 0; }
.search-panel-hero-inner { padding: 2.4rem 1rem 1.4rem; }
.search-panel-title { margin: 0 0 0.7rem; font-family: var(--font-display); font-size: clamp(1.5rem, 3.2vw, 2.15rem); font-weight: 700; line-height: 1.12; letter-spacing: -0.025em; color: var(--color-primary); }
.search-panel-sub { margin: 0 auto; max-width: 30rem; color: var(--color-text-muted); font-size: 1rem; line-height: 1.5; }
.search-panel[data-state="expanded"] .search-panel-hero { grid-template-rows: 0fr; opacity: 0; margin: 0; }

/* Search bar row + suggestions dropdown. */
.search-panel-barrow { position: relative; padding: 0 0.2rem; }
.search-panel-form { position: relative; display: flex; align-items: center; }
.search-panel-icon { position: absolute; left: 1.05rem; top: 50%; transform: translateY(-50%); width: 19px; height: 19px; color: var(--color-text-muted); pointer-events: none; }
.search-panel-icon svg { width: 100%; height: 100%; display: block; }
.search-panel-input {
  width: 100%; box-sizing: border-box; height: 52px; padding: 0 3rem 0 3rem;
  border: 1.5px solid #e2e6ee; border-radius: 999px; background: #f7f9fc;
  font-family: inherit; font-size: 1.05rem; color: var(--color-text);
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.search-panel-input::placeholder { color: #9aa3b2; }
.search-panel-input:focus { outline: none; border-color: var(--color-accent, #f97316); background: #fff; box-shadow: 0 0 0 4px rgba(249, 115, 22, 0.12); }
.search-panel-clear { position: absolute; right: 0.55rem; top: 50%; transform: translateY(-50%); width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; background: #eceff4; border: none; border-radius: 50%; color: var(--color-text-muted); cursor: pointer; }
.search-panel-clear:hover { background: #e0e4ec; color: var(--color-text); }
.search-panel-clear svg { width: 13px; height: 13px; display: block; }
.search-panel[data-state="expanded"] .search-panel-input { height: 46px; font-size: 1rem; }

/* Suggestions dropdown. */
.search-panel-suggest {
  position: absolute; left: 0.2rem; right: 0.2rem; top: calc(100% + 0.4rem); z-index: 5;
  background: #fff; border: 1px solid #e7eaf0; border-radius: 12px;
  box-shadow: 0 16px 36px -12px rgba(15, 23, 42, 0.28); overflow: hidden; padding: 0.3rem;
}
.search-panel-suggest[hidden] { display: none; }
.search-panel-suggest-row { display: flex; align-items: baseline; gap: 0.5rem; width: 100%; text-align: left; padding: 0.55rem 0.7rem; background: none; border: none; border-radius: 8px; cursor: pointer; font-family: inherit; color: var(--color-text); }
.search-panel-suggest-row:hover, .search-panel-suggest-row.is-active { background: #f1f4f9; }
.search-panel-suggest-name { font-size: 0.96rem; font-weight: 600; }
.search-panel-suggest-parent { font-size: 0.8rem; color: var(--color-text-muted); }
.search-panel-suggest-row.is-custom .search-panel-suggest-name { font-weight: 600; color: var(--color-primary); }

/* Tools (copy link) — shown only in expanded state. */
.search-panel-tools { display: flex; align-items: center; gap: 0.6rem; padding: 0.7rem 0.4rem 0.2rem; }
.search-panel-tools[hidden] { display: none; }
.search-panel-copy { display: inline-flex; align-items: center; gap: 0.4rem; background: #f1f4f9; border: 1px solid #e2e6ee; border-radius: 8px; padding: 0.35rem 0.7rem; font-family: inherit; font-size: 0.85rem; color: var(--color-text-muted); cursor: pointer; transition: background 0.14s, color 0.14s; }
.search-panel-copy:hover { background: #e8edf4; color: var(--color-text); }
.search-panel-copy svg { width: 14px; height: 14px; display: block; }
.search-panel-copy.is-copied { color: #15803d; border-color: #bbf7d0; background: #f0fdf4; }

/* Results host — reveals via grid-rows. */
.search-panel-results { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 0.35s ease, opacity 0.3s ease; }
.search-panel-results > * { overflow: hidden; min-height: 0; }
.search-panel[data-state="expanded"] .search-panel-results { grid-template-rows: 1fr; opacity: 1; }
.search-panel-results .shortcuts-sidebar { border: none; box-shadow: none; padding: 0; margin: 0; background: transparent; max-width: none; }
.search-panel-results .ti-accordions { display: grid; grid-template-columns: 1fr; gap: 0.6rem; padding-top: 0.9rem; }
@media (min-width: 720px) {
  .search-panel-results .ti-accordions { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.65rem 0.9rem; align-items: start; }
}
```

- [ ] **Step 2:** Bump cache-bust in `index.html:83`: change `css/styles.css?v=20260603-takeover-modals` → `css/styles.css?v=20260603-search-panel`.
- [ ] **Step 3:** Brace balance check (command in the header note). Expected: `CSS balanced`.
- [ ] **Step 4:** Commit: `git add -A && git commit -m "Add expanding search-panel shell CSS"`.

---

### Task 2: `renderSearchPanel()` core + refactor the modal to use it

**Files:** Modify `js/app.js` (add `renderSearchPanel`, `LINK_ICON_SVG`; replace `renderSearchModalBody`/`wireSearchModal` bodies).

- [ ] **Step 1:** Add the link icon constant next to `SEARCH_ICON_SVG`/`X_ICON_SVG`:

```js
const LINK_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
```

- [ ] **Step 2:** Add `renderSearchPanel`. It builds the markup, wires the form/suggestions/tools, and returns a controller. (Suggestions wiring is filled in Task 4 — here `refreshSuggestions` just hides the dropdown so the function is complete and testable.)

```js
// Shared expanding search panel — used by the nav modal (mode:'modal')
// and the homepage hero (mode:'inline'). Returns a controller.
function renderSearchPanel(container, { mode = 'inline', term = '' } = {}) {
  const isModal = mode === 'modal';
  container.innerHTML = `
    <div class="search-panel search-panel--${mode}" data-state="collapsed">
      ${isModal ? `<button type="button" class="takeover-close search-panel-close" aria-label="Close">${X_ICON_SVG}</button>` : ''}
      <div class="search-panel-hero"><div class="search-panel-hero-inner">
        <h2 class="search-panel-title">News, Resources and AI Knowledge.<br>On any topic.</h2>
        <p class="search-panel-sub">Type any topic and we'll build out web sources, AI shortcuts, and analysis tools tailored to it.</p>
      </div></div>
      <div class="search-panel-barrow">
        <form class="search-panel-form" role="search" autocomplete="off">
          <span class="search-panel-icon" aria-hidden="true">${SEARCH_ICON_SVG}</span>
          <input class="search-panel-input" type="search" placeholder="Search any topic…" aria-label="Search any topic" value="${escapeAttr(term)}">
          <button type="button" class="search-panel-clear" aria-label="Clear search" hidden>${X_ICON_SVG}</button>
        </form>
        <div class="search-panel-suggest" role="listbox" hidden></div>
      </div>
      <div class="search-panel-tools" hidden>
        <button type="button" class="search-panel-copy">${LINK_ICON_SVG}<span>Copy link</span></button>
      </div>
      <div class="search-panel-results"><div class="search-panel-results-inner"></div></div>
    </div>`;

  const panelEl = container.querySelector('.search-panel');
  const form = panelEl.querySelector('.search-panel-form');
  const input = panelEl.querySelector('.search-panel-input');
  const clearBtn = panelEl.querySelector('.search-panel-clear');
  const suggestEl = panelEl.querySelector('.search-panel-suggest');
  const toolsEl = panelEl.querySelector('.search-panel-tools');
  const copyBtn = panelEl.querySelector('.search-panel-copy');
  const resultsInner = panelEl.querySelector('.search-panel-results-inner');
  let currentTerm = '';

  function expand(rawTerm) {
    const t = (rawTerm || '').trim();
    if (!t) return;
    currentTerm = t;
    input.value = t;
    clearBtn.hidden = false;
    hideSuggest();
    resultsInner.innerHTML = '';
    renderShortcutsSidebar(resultsInner, { type: 'custom', term: t, tab: 'shortcuts' }, false, true, t);
    panelEl.dataset.state = 'expanded';
    toolsEl.hidden = true;   // copy-link wired + revealed (inline only) in Task 6
    ctl.onExpand && ctl.onExpand(t);
  }
  function collapse() {
    currentTerm = '';
    input.value = '';
    clearBtn.hidden = true;
    toolsEl.hidden = true;
    panelEl.dataset.state = 'collapsed';
    hideSuggest();
    resultsInner.innerHTML = '';
    ctl.onCollapse && ctl.onCollapse();
  }
  function hideSuggest() { suggestEl.hidden = true; suggestEl.innerHTML = ''; }
  function refreshSuggestions() { hideSuggest(); } // replaced in Task 4

  form.addEventListener('submit', (e) => { e.preventDefault(); const v = input.value.trim(); if (v) expand(v); });
  input.addEventListener('input', () => { clearBtn.hidden = !input.value; refreshSuggestions(); });
  clearBtn.addEventListener('click', () => { collapse(); input.focus(); });
  copyBtn.addEventListener('click', () => {}); // wired in Task 6
  panelEl.querySelector('.search-panel-close')?.addEventListener('click', () => userCloseSearchModal());

  const ctl = { el: panelEl, input, expand, collapse, refreshSuggestions, onExpand: null, onCollapse: null,
    setTerm(t) { input.value = t || ''; clearBtn.hidden = !input.value; },
    focus() { try { input.focus(); } catch (_) {} } };
  if (term && term.trim()) expand(term);
  return ctl;
}
```

- [ ] **Step 3:** Replace the modal body renderer. Find `renderSearchModalBody` + `wireSearchModal` and replace BOTH with a single thin renderer that delegates to `renderSearchPanel`. Also add a module var `let searchPanelModalCtl = null;` next to `searchModalTerm`.

```js
function renderSearchModalBody(term) {
  searchPanelModalCtl = renderSearchPanel(searchModalPanel, { mode: 'modal', term });
  if (!term || !term.trim()) setTimeout(() => searchPanelModalCtl.focus(), 60);
}
```

(Delete the old `wireSearchModal` function entirely. `openSearchPageModal`/`closeSearchPageModal`/`userCloseSearchModal` from Phase 12 stay as-is for now; Task 3 adjusts `openSearchPageModal`.)

- [ ] **Step 4:** `node --check js/app.js` → no output (OK). Browser (1280): load `index.html?cb=...#/search`; expect the hero (collapsed) with the search bar; type `tesla` + Enter; expect the hero to collapse and accordions to appear *within the same modal* with a smooth grow (state `expanded`). Screenshot `/tmp/p13-modal-expand.png` and eyeball the transition end-state.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "Add shared renderSearchPanel; refactor modal to use it"`.

---

### Task 3: Smooth modal expand without re-render + URL guard

**Files:** Modify `js/app.js` (`openSearchPageModal`).

- [ ] **Step 1:** Make `openSearchPageModal(term)` expand the *existing* panel instead of rebuilding when the modal is already open, so the `#/custom/{term}` URL update from a submit doesn't replace the animating panel. Replace the body of `openSearchPageModal`:

```js
function openSearchPageModal(term) {
  if (!searchModalOverlay) return;
  const t = (term || '').trim();
  if (isSearchModalOpen() && searchPanelModalCtl) {
    // Already open — expand/collapse the live panel (keeps the animation).
    if (t) searchPanelModalCtl.expand(t); else searchPanelModalCtl.collapse();
    return;
  }
  searchModalTerm = t;
  renderSearchModalBody(t);
  searchModalOverlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  searchModalPanel.classList.remove('is-in');
  void searchModalPanel.offsetWidth;
  searchModalPanel.classList.add('is-in');
}
```

- [ ] **Step 2:** Make the modal's free-text submit update the URL (shareable) — set the panel's `onExpand` in `renderSearchModalBody` so a modal expand pushes `#/custom/{term}` without rebuilding (the guard in Step 1 makes the resulting `openSearchPageModal` call a no-op re-expand):

```js
function renderSearchModalBody(term) {
  searchPanelModalCtl = renderSearchPanel(searchModalPanel, { mode: 'modal', term });
  searchPanelModalCtl.onExpand = (t) => {
    const target = '#/custom/' + encodeURIComponent(t);
    if (window.location.hash !== target) navigate(target);
  };
  if (!term || !term.trim()) setTimeout(() => searchPanelModalCtl.focus(), 60);
}
```

- [ ] **Step 3:** `node --check js/app.js`. Browser (1280): `index.html?cb=...#/search` → type `openai` + Enter → URL becomes `#/custom/openai` AND the panel expands smoothly (no flash/teardown). Then load `index.html?cb=...#/custom/tesla` directly → modal opens already-expanded with `tesla` accordions. Confirm `.search-page-results`/`.search-panel-results .ti-accordion` count ≥ 4. Screenshot `/tmp/p13-modal-deeplink.png`.
- [ ] **Step 4:** Commit: `git add -A && git commit -m "Modal: expand in place + keep #/custom URL without re-render"`.

---

### Task 4: Live topic-match suggestions

**Files:** Modify `js/app.js` (add `searchTopics` to the `data.js` import; implement suggestions inside `renderSearchPanel`).

- [ ] **Step 1:** Confirm `searchTopics` is imported. The `data.js` import line already lists `searchTopics` — if not, add it. (It is present per `grep`.)

- [ ] **Step 2:** Replace the placeholder `refreshSuggestions` + `hideSuggest` inside `renderSearchPanel` and add keyboard handling. Insert this in place of the Task-2 `refreshSuggestions`/`hideSuggest`, and add the keydown listener:

```js
  let suggestItems = [];   // [{type:'topic', slug, name, parent} | {type:'custom', term}]
  let activeIdx = -1;

  function hideSuggest() { suggestEl.hidden = true; suggestEl.innerHTML = ''; suggestItems = []; activeIdx = -1; }
  function refreshSuggestions() {
    const q = input.value.trim();
    if (!q || panelEl.dataset.state === 'expanded') { hideSuggest(); return; }
    const topics = searchTopics(q).slice(0, 6);
    suggestItems = topics.map(t => ({ type: 'topic', slug: t.slug, name: t.name, parent: t.parentName }))
      .concat([{ type: 'custom', term: q }]);
    activeIdx = -1;
    suggestEl.innerHTML = suggestItems.map((it, i) => it.type === 'topic'
      ? `<button type="button" class="search-panel-suggest-row" data-i="${i}" role="option"><span class="search-panel-suggest-name">${escapeHTML(it.name)}</span>${it.parent ? `<span class="search-panel-suggest-parent">${escapeHTML(it.parent)}</span>` : ''}</button>`
      : `<button type="button" class="search-panel-suggest-row is-custom" data-i="${i}" role="option"><span class="search-panel-suggest-name">Search "${escapeHTML(it.term)}" &rarr;</span></button>`
    ).join('');
    suggestEl.hidden = false;
    suggestEl.querySelectorAll('.search-panel-suggest-row').forEach(row => {
      row.addEventListener('click', () => chooseSuggestion(Number(row.dataset.i)));
    });
  }
  function chooseSuggestion(i) {
    const it = suggestItems[i];
    if (!it) return;
    if (it.type === 'topic') {
      hideSuggest();
      if (isModal) { closeSearchPageModal(); document.body.style.overflow = ''; }
      navigate('#/topic/' + it.slug);
    } else {
      expand(it.term);
    }
  }
  function moveActive(d) {
    if (suggestEl.hidden || !suggestItems.length) return;
    activeIdx = (activeIdx + d + suggestItems.length) % suggestItems.length;
    suggestEl.querySelectorAll('.search-panel-suggest-row').forEach((r, i) => r.classList.toggle('is-active', i === activeIdx));
  }
```

Add this keydown listener (after the `input` listener):

```js
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
    else if (e.key === 'Enter' && activeIdx >= 0 && !suggestEl.hidden) { e.preventDefault(); chooseSuggestion(activeIdx); }
    else if (e.key === 'Escape' && !suggestEl.hidden) { e.preventDefault(); hideSuggest(); }
  });
  document.addEventListener('click', (e) => { if (!panelEl.contains(e.target)) hideSuggest(); });
```

(The `escapeHTML` helper already exists in `app.js`.)

- [ ] **Step 3:** `node --check js/app.js`. Browser (1280): open `#/search`, type `tech` → dropdown lists matching topics + a `Search "tech" →` row. Click a topic row → URL `#/topic/{slug}` and modal closes. Re-open, type `zzzznotopic` → only the custom row shows; click it → expands accordions. Screenshot `/tmp/p13-suggest.png`.
- [ ] **Step 4:** Commit: `git add -A && git commit -m "Search panel: live topic-match suggestions + keyboard nav"`.

---

### Task 5: Homepage inline hero (desktop scrolling page)

**Files:** Modify `js/app.js` (`renderLayout` app-mode gating; `renderTopicLayout` home branch). Modify `css/styles.css` (home-search layout).

- [ ] **Step 1:** In `renderLayout`, stop applying `app-mode` to the home route so the homepage scrolls. Change:

```js
  if (route.type === 'home' || route.type === 'topic') {
    document.body.classList.add('app-mode');
  }
```
to:
```js
  if (route.type === 'topic') {
    document.body.classList.add('app-mode');
  }
  if (route.type === 'home') {
    document.body.classList.add('home-search');   // scrolling home with the search hero
  }
```
Also add `'home-search'` to the `classList.remove(...)` reset list near the top of `renderLayout` (the line that removes `'sticky-always', 'has-subnav', 'home-mode', ...`).

- [ ] **Step 2:** In `renderTopicLayout`, home branch, prepend the inline hero container above `.topic-layout`. Replace the `else if (isHome)` markup block with:

```js
  } else if (isHome) {
    container.innerHTML = `
      <div class="home-search-hero" id="home-search-hero"></div>
      <div class="topic-layout" id="topic-layout">
        ${bodyTabsRow({ showRelated: false, showTrending: true })}
        <section class="layout-section" id="section-trending"></section>
        <section class="layout-section" id="section-shortcuts"></section>
        <section class="layout-section" id="section-newsfeed"></section>
      </div>
    `;
    homeSearchPanelCtl = renderSearchPanel(container.querySelector('#home-search-hero'), { mode: 'inline' });
```

Add a module var near the modal vars: `let homeSearchPanelCtl = null;`.

- [ ] **Step 3:** Append home-search CSS. The hero centers at the top; the page scrolls; content sits below.

```css

/* === Homepage inline search hero ===================================== */
body.home-search #content { display: block; max-width: none; overflow: visible; height: auto; max-height: none; }
.home-search-hero { max-width: 960px; margin: 0 auto; padding: 1.4rem 1rem 0.6rem; }
.home-search-hero .search-panel-results { max-width: 100%; }
/* Give the content below the hero breathing room (pushed down). */
body.home-search #topic-layout { margin-top: 0.6rem; }
```

- [ ] **Step 4:** Brace check + `node --check js/app.js`. Browser (1280): load `index.html?cb=...#/` → the search hero shows at the top (collapsed, centered), and News Feed / Topic Intelligence render BELOW it; the page scrolls. Type `tesla` + Enter in the hero → hero collapses, accordions expand inline, pushing content down. Screenshots `/tmp/p13-home-desktop.png` (collapsed) + `/tmp/p13-home-expanded.png`.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "Homepage: inline expanding search hero (scrolling home)"`.

---

### Task 6: Copy-link + clear (inline) + tools polish

**Files:** Modify `js/app.js` (`renderSearchPanel` copy wiring + tools visibility).

- [ ] **Step 1:** Fix the `expand()` tools logic so the Copy-link bar shows in **inline** mode (not modal — the modal already has the shareable URL). Replace the tools lines inside `expand()`:

```js
    panelEl.dataset.state = 'expanded';
    toolsEl.hidden = isModal;   // copy-link only on the inline homepage hero
    ctl.onExpand && ctl.onExpand(t);
```

- [ ] **Step 2:** Wire the Copy button to copy the shareable `#/custom/{term}` URL with a transient confirm. Replace the `copyBtn.addEventListener('click', () => {});` stub:

```js
  copyBtn.addEventListener('click', async () => {
    if (!currentTerm) return;
    const url = location.origin + location.pathname + '#/custom/' + encodeURIComponent(currentTerm);
    try { await navigator.clipboard.writeText(url); } catch (_) {
      const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (_) {} ta.remove();
    }
    const label = copyBtn.querySelector('span');
    copyBtn.classList.add('is-copied'); if (label) label.textContent = 'Copied';
    setTimeout(() => { copyBtn.classList.remove('is-copied'); if (label) label.textContent = 'Copy link'; }, 1600);
  });
```

- [ ] **Step 3:** `node --check js/app.js`. Browser (1280): `#/` → type `tesla` + Enter → the Copy link button appears in the inline hero; click it → label flips to `Copied`; verify the clipboard via `await navigator.clipboard.readText()` equals `…/#/custom/tesla`. Click the ✕ clear → collapses back to the hero. Confirm the modal (`#/search` → submit) does NOT show the copy bar. Screenshot `/tmp/p13-copylink.png`.
- [ ] **Step 4:** Commit: `git add -A && git commit -m "Inline search hero: copy-link + clear/collapse"`.

---

### Task 7: Mobile homepage — sticky tabs + one-way hero fade

**Files:** Modify `css/styles.css` (mobile sticky tabs + hero fade var). Modify `js/app.js` (scroll listener wiring in the home branch).

- [ ] **Step 1:** Append mobile CSS. The body-tabs row sticks under the nav; the hero fades/translates via a CSS var driven by JS, and is `display:none` once latched.

```css

/* === Mobile homepage: sticky tabs + fading search hero =============== */
@media (max-width: 899.98px) {
  body.home-search .body-tabs {
    position: sticky; top: var(--subnav-height, 0px); z-index: 8;
    background: var(--color-bg, #fff); padding: 0.5rem 0; margin: 0 -0.2rem;
  }
  body.home-search .home-search-hero {
    opacity: var(--hero-fade, 1);
    transform: translateY(calc((1 - var(--hero-fade, 1)) * -12px));
    transition: opacity 0.12s linear;
  }
  body.home-search.hero-dismissed .home-search-hero { display: none; }
}
```

- [ ] **Step 2:** In `renderTopicLayout` home branch, after creating `homeSearchPanelCtl`, wire a mobile-only scroll listener that fades the hero and latches it dismissed. Add right after the `homeSearchPanelCtl = renderSearchPanel(...)` line:

```js
    setupHomeHeroFade(container.querySelector('#home-search-hero'));
```

Add this function near `renderSearchPanel`:

```js
let homeHeroScrollHandler = null;
function setupHomeHeroFade(heroEl) {
  if (homeHeroScrollHandler) { window.removeEventListener('scroll', homeHeroScrollHandler); homeHeroScrollHandler = null; }
  if (!heroEl) return;
  const isMobile = () => window.matchMedia(MOBILE_QUERY).matches;
  document.body.classList.remove('hero-dismissed');
  document.documentElement.style.setProperty('--hero-fade', '1');
  homeHeroScrollHandler = () => {
    if (!isMobile() || document.body.classList.contains('hero-dismissed')) return;
    // Don't fade while the user is mid-search (expanded).
    if (heroEl.querySelector('.search-panel[data-state="expanded"]')) return;
    const h = heroEl.offsetHeight || 1;
    const y = window.scrollY;
    const fade = Math.max(0, 1 - y / (h * 0.7));
    document.documentElement.style.setProperty('--hero-fade', String(fade));
    if (y > h) { document.body.classList.add('hero-dismissed'); }   // one-way latch
  };
  window.addEventListener('scroll', homeHeroScrollHandler, { passive: true });
}
```

(`MOBILE_QUERY` already exists in `app.js`.)

- [ ] **Step 3:** Ensure the handler is cleaned up when leaving home. In `renderLayout`, near the existing `if (heroScrollHandler) { ... }` cleanup, also clear the hero-fade latch so returning home resets it: add `document.body.classList.remove('hero-dismissed');` in the non-home path is unnecessary — instead, `setupHomeHeroFade` already removes the class on each home render (Step 2). No extra change needed; verify by reading.
- [ ] **Step 4:** Brace check + `node --check js/app.js`. Browser (390): load `index.html?cb=...#/` → hero visible at top. `window.scrollTo(0, 400)` → hero opacity drops; after scrolling past hero height, `document.body.classList.contains('hero-dismissed')` is `true`; scroll back to 0 → hero stays hidden (one-way). The body-tabs row is sticky (its `getBoundingClientRect().top` ≈ `--subnav-height` while scrolled). Nav magnifier still opens the modal. Screenshots `/tmp/p13-mobile-hero.png` + `/tmp/p13-mobile-scrolled.png`.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "Mobile home: sticky tabs + one-way fading search hero"`.

---

### Task 8: Full verification + deploy

**Files:** none (verification) → then push.

- [ ] **Step 1:** Playwright sweep, fresh context + `Network.setCacheDisabled`, `index.html?cb=N`:
  - **Desktop 1280:** `#/` hero on top + content below + scrolls; inline search expands accordions + collapses hero + Copy link works + ✕ collapses; suggestions (topic click → `#/topic/{slug}`; custom row → expand); nav magnifier → modal; modal submit expands smoothly + sets `#/custom/{term}`; `#/custom/tesla` deep-link → modal pre-expanded.
  - **Mobile 390:** `#/` hero visible; scroll → hero fades + latches dismissed (stays gone on scroll-up); sticky tabs; nav magnifier → modal.
  - Topic page (`#/topic/technology`) still renders (app-mode unchanged for topics).
- [ ] **Step 2:** `node --check js/app.js`; CSS brace balance; `node tools/test_trending_normalize.mjs` (expect `OK: normalizeTrending`).
- [ ] **Step 3:** Commit any outstanding; `git push origin main`. Verify live at standardtopic.com (hard refresh).

---

## Notes
- **One renderer, two surfaces:** `renderSearchPanel` is the only place the hero/expand/suggestions live; the modal and homepage just host it. Don't duplicate the animation.
- **grid-rows animation:** `grid-template-rows: 0fr → 1fr` (with `overflow:hidden` children) is what makes the hero collapse and results reveal animate to *content height* without hardcoded max-heights.
- **Modal keeps its URL; inline does not.** Inline shareability is the Copy-link button only (copies `#/custom/{term}`, which opens the modal when visited).
- **Mobile fade is one-way** by design (latched via `body.hero-dismissed`); re-search = reload or nav magnifier.
- Phase 12 dead custom-page code (`renderCustomSearchBar`, `setupCustomStickyBar`, `renderTopicLayout` `isCustom` branch, `body.custom-mode`) remains unreachable and untouched.

# Trending Detail Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Clicking a Trending Now row opens a slim modal (term + context + Google Trends link + admin-managed "Trending 101" shortcuts + the Topic-Intelligence accordions scoped to the term as "Trending Intelligence") instead of navigating to Custom Search.

**Architecture:** Expand the trending normalizer to pass `trendBreakdown` + `googleTrendsUrl` (same API call). Extract the shared TI accordion builders (`groupShortcuts`, `renderTIAccordion`, `webSourceItem`, `TI_SECTION_META`, `DEFAULT_GROUP_DEFS`) from `app.js` into `js/components/ti-shortcuts.js`. A new modal component renders the detail view and reuses those + the existing `open-prompt-modal` flow for single-tap submission.

**Tech Stack:** Vanilla JS ES modules, CSS, Node test.

Spec: `docs/superpowers/specs/2026-06-03-trending-detail-modal-design.md`

---

### Task 1: Normalizer passthrough (trendBreakdown + googleTrendsUrl)

**Files:** Modify `js/utils/trending-normalize.js`; Test `tools/test_trending_normalize.mjs`

- [ ] **Step 1: Extend the test** — append to `tools/test_trending_normalize.mjs` before the final `console.log`:

```js
// trendBreakdown + googleTrendsUrl passthrough
const br = { trending_searches: [
  { query: 'Foo Bar', start_timestamp: 1700000000, trend_breakdown: ['a', 'b', '', null, 'c'] },
  { query: 'No Breakdown' },
] };
const bo = normalizeTrending([{ geo: 'US', data: br }], 20);
assert.deepEqual(bo[0].trendBreakdown, ['a', 'b', 'c'], 'keeps non-empty breakdown terms');
assert.equal(bo[0].googleTrendsUrl, 'https://trends.google.com/trends/explore?q=Foo%20Bar&geo=US');
assert.deepEqual(bo[1].trendBreakdown, [], 'defaults breakdown to []');
```

- [ ] **Step 2: Run, expect FAIL** — `node tools/test_trending_normalize.mjs` → AssertionError on `trendBreakdown`.

- [ ] **Step 3: Implement** — in `js/utils/trending-normalize.js`, inside the push object add the two fields (after `region`):

```js
      out.push({
        query,
        categories: Array.isArray(t && t.categories) ? t.categories.map(c => c && c.name).filter(Boolean) : [],
        startedAt: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null,
        region: geo,
        trendBreakdown: Array.isArray(t && t.trend_breakdown) ? t.trend_breakdown.filter(Boolean).map(s => String(s)) : [],
        googleTrendsUrl: `https://trends.google.com/trends/explore?q=${encodeURIComponent(query)}&geo=${encodeURIComponent(geo || 'US')}`,
      });
```

- [ ] **Step 4: Run, expect PASS** — `node tools/test_trending_normalize.mjs` → `OK: normalizeTrending`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "Trending normalizer: pass through related searches + Google Trends URL"`

---

### Task 2: Trending 101 data + loader

**Files:** Create `data/shortcuts-trending101.json`; Modify `js/utils/data.js`

- [ ] **Step 1: Create** `data/shortcuts-trending101.json`:

```json
{
  "shortcuts": [
    { "id": "why-trending", "name": "Why It's Trending", "icon": "fire", "description": "The story behind the spike", "prompt": "Explain why {topic} is trending right now — what happened, when, and what's driving the surge in interest. Keep it to a few clear sentences." },
    { "id": "the-backstory", "name": "The Backstory", "icon": "book", "description": "How we got here", "prompt": "Give me the essential background on {topic} so the current moment makes sense — what led up to this and what I need to know to follow it." },
    { "id": "whos-involved", "name": "Who's Involved", "icon": "handshake", "description": "The main players", "prompt": "Who are the key people, organizations, or teams behind {topic} right now, and what role does each play? Keep it brief." },
    { "id": "whats-next", "name": "What's Next", "icon": "compass", "description": "What to watch for", "prompt": "What happens next with {topic}? What should I watch for in the coming days, and why does it matter?" }
  ]
}
```

- [ ] **Step 2: Load it** — in `js/utils/data.js`: add `let trending101Data = null;`, add the fetch to the `Promise.all` in `loadAllData` (with `.catch(() => ({ shortcuts: [] }))`), assign it, and add getters:

```js
export function getTrending101() {
  return trending101Data?.shortcuts || [];
}
// Evergreen shortcuts as a generic term list (for Trending Intelligence),
// ordered by evergreenOrder — same selection custom-search uses, minus any
// topic context.
export function getTrendingIntelligenceShortcuts() {
  const dir = shortcutsDirectory?.shortcuts || [];
  const orderIdx = new Map((shortcutsAssignments?.evergreenOrder || []).map((id, i) => [id, i]));
  return dir.filter(s => s.evergreen)
    .sort((a, b) => (orderIdx.has(a.id) ? orderIdx.get(a.id) : 1e9) - (orderIdx.has(b.id) ? orderIdx.get(b.id) : 1e9));
}
```
(Concretely: change the `Promise.all` array to include `fetchJSON('data/shortcuts-trending101.json').catch(() => ({ shortcuts: [] }))` as a 7th entry, destructure it as `trending101`, and `trending101Data = trending101;`.)

- [ ] **Step 3: Syntax check** — `node --check js/utils/data.js` → no output.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "Add Trending 101 data + getters"`

---

### Task 3: Extract shared TI builders → `js/components/ti-shortcuts.js`

**Files:** Create `js/components/ti-shortcuts.js`; Modify `js/app.js`

- [ ] **Step 1: Create** `js/components/ti-shortcuts.js` by MOVING these exact definitions out of `js/app.js` (verbatim) and exporting them: `DEFAULT_GROUP_DEFS`, `TI_SECTION_META`, `groupShortcuts`, `renderTIAccordion`, `webSourceItem`. Add at the top of the new file local helpers + import:

```js
import { } from '../utils/icons.js'; // (none needed; TI_SECTION_META uses inline SVG)
function escapeHTML(str) { const div = document.createElement('div'); div.textContent = str ?? ''; return div.innerHTML; }
function escapeAttr(str) { return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
```
Export each moved symbol (`export const DEFAULT_GROUP_DEFS = …`, `export const TI_SECTION_META = …`, `export function groupShortcuts(…)`, `export function renderTIAccordion(…)`, `export function webSourceItem(…)`). `groupShortcuts` keeps using `window.__assignmentsData` and the module-scoped `DEFAULT_GROUP_DEFS`.

- [ ] **Step 2: Rewire `app.js`** — remove the moved definitions from `app.js` and add to the import block near the other component imports:

```js
import { DEFAULT_GROUP_DEFS, TI_SECTION_META, groupShortcuts, renderTIAccordion, webSourceItem } from './components/ti-shortcuts.js';
```
(`tiShortcutItem` stays in `app.js`; it references the now-imported nothing — it only uses `escapeHTML`/`escapeAttr` which remain in `app.js`.)

- [ ] **Step 3: Syntax check** — `node --check js/app.js && node --check js/components/ti-shortcuts.js` → no output.

- [ ] **Step 4: Browser check (sidebar parity)** — serve (`python3 -m http.server 8765`), open home, expand a Topic Intelligence accordion (Discover/Learn/etc.) and confirm shortcuts + Web Sources still render exactly as before.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "Extract shared TI accordion builders into ti-shortcuts.js"`

---

### Task 4: Trending detail modal component

**Files:** Create `js/components/trending-detail-modal.js`; Modify `js/app.js` (init), `index.html` (none — module loaded via app.js)

- [ ] **Step 1: Implement** `js/components/trending-detail-modal.js`:

```js
// Slim modal shown when a Trending Now row is clicked. Renders the term,
// related searches + a Google Trends link, the admin-managed Trending 101
// shortcuts, and the Topic-Intelligence accordions scoped to the term
// ("Trending Intelligence"). Opened via `open-trending-detail` with the
// full trending item. Shortcut clicks reuse the existing prompt modal.
import { getTrending101, getTrendingIntelligenceShortcuts, getExternalSearches, getExternalSearchCategories } from '../utils/data.js';
import { groupShortcuts, renderTIAccordion, webSourceItem } from './ti-shortcuts.js';

let overlayEl = null;
let panelEl = null;

function escapeHTML(s){ const d=document.createElement('div'); d.textContent=s??''; return d.innerHTML; }
function escapeAttr(s){ return String(s??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }
function titleCase(s){ return String(s||'').replace(/\b\w/g, c => c.toUpperCase()); }
function relTime(iso){ if(!iso) return ''; const t=new Date(iso).getTime(); if(Number.isNaN(t)) return ''; const m=Math.max(0,Math.round((Date.now()-t)/60000)); if(m<60) return `${m||1} min ago`; const h=Math.round(m/60); if(h<24) return `${h} hr ago`; return `${Math.round(h/24)} d ago`; }

export function initTrendingDetailModal() {
  overlayEl = document.createElement('div');
  overlayEl.className = 'td-overlay';
  overlayEl.style.display = 'none';
  document.body.appendChild(overlayEl);
  panelEl = document.createElement('div');
  panelEl.className = 'td-panel';
  panelEl.setAttribute('role','dialog'); panelEl.setAttribute('aria-modal','true');
  panelEl.style.display = 'none';
  document.body.appendChild(panelEl);
  window.addEventListener('open-trending-detail', (e) => open(e.detail));
  overlayEl.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlayEl.style.display !== 'none') close(); });
}

function shortcutRow(s, term) {
  const prompt = (s.prompt || '').replace(/\{topic\}/gi, term);
  const desc = s.description ? `<span class="td-row-desc">${escapeHTML(s.description)}</span>` : '';
  return `<button type="button" class="td-shortcut" data-prompt="${escapeAttr(prompt)}" data-name="${escapeAttr(s.name)}" data-icon="${escapeAttr(s.icon||'')}">
      <span class="td-row-text"><span class="td-row-name">${escapeHTML(s.name)}</span>${desc}</span>
      <svg class="td-row-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
    </button>`;
}

function trendingIntelligenceHTML(term) {
  let html = '<div class="ti-accordions">';
  // Web Sources (grouped by category, like the sidebar)
  const searches = getExternalSearches();
  if (searches.length) {
    const cats = getExternalSearchCategories();
    const order = cats.length ? cats.slice() : [{ key: '__all', label: '' }];
    const known = new Set(order.map(c => c.key));
    const leftovers = searches.filter(s => !known.has(s.category));
    if (leftovers.length) order.push({ key: '__other', label: 'Other' });
    const groupsHTML = order.map(cat => {
      const items = cat.key === '__other' ? leftovers : cat.key === '__all' ? searches : searches.filter(s => s.category === cat.key);
      if (!items.length) return '';
      const heading = cat.label ? `<li class="ti-subhead" aria-hidden="true">${escapeHTML(cat.label)}</li>` : '';
      return `<ul class="ti-item-list ti-item-list-grouped">${heading}${items.map(s => webSourceItem(s, term)).join('')}</ul>`;
    }).join('');
    html += renderTIAccordion({ key: 'websources', label: 'Web Sources', open: false, bodyHTML: `<div class="ti-source-groups">${groupsHTML}</div>` });
  }
  // AI groups (Discover/Learn/Analyze/More) from evergreen shortcuts
  const groups = groupShortcuts(getTrendingIntelligenceShortcuts(), {});
  (groups.__order || []).forEach(g => {
    const items = groups[g.key];
    if (!items || !items.length) return;
    html += renderTIAccordion({ key: g.key, label: g.label, open: false,
      bodyHTML: `<ul class="ti-item-list ti-item-list-shortcuts td-shortcut-list">${items.map(s => shortcutRow(s, term)).join('')}</ul>` });
  });
  html += '</div>';
  return html;
}

function open(item) {
  if (!item || !item.query) return;
  const term = item.query;
  const since = relTime(item.startedAt);
  const cat = item.category || (Array.isArray(item.categories) ? item.categories[0] : '') || '';
  const subParts = [cat, since ? `Trending since ${since}` : ''].filter(Boolean).join(' · ');
  const related = Array.isArray(item.trendBreakdown) ? item.trendBreakdown.slice(0, 6) : [];
  const t101 = getTrending101();

  panelEl.innerHTML = `
    <div class="td-header">
      <div>
        <span class="td-eyebrow">Trending Now</span>
        <h3 class="td-title">${escapeHTML(titleCase(term))}</h3>
        ${subParts ? `<p class="td-sub">${escapeHTML(subParts)}</p>` : ''}
      </div>
      <button type="button" class="td-close" id="td-close" aria-label="Close"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg></button>
    </div>
    <div class="td-body">
      ${related.length ? `<p class="td-related"><span class="td-related-label">Related:</span> ${related.map(escapeHTML).join(' · ')}</p>` : ''}
      ${item.googleTrendsUrl ? `<a class="td-trends-link" href="${escapeAttr(item.googleTrendsUrl)}" target="_blank" rel="noopener noreferrer">View on Google Trends ↗</a>` : ''}
      ${t101.length ? `<section class="td-section"><div class="td-section-label">Trending 101</div>
        <ul class="ti-item-list td-shortcut-list">${t101.map(s => shortcutRow(s, term)).join('')}</ul></section>` : ''}
      <section class="td-section"><div class="td-section-label">Trending Intelligence</div>
        ${trendingIntelligenceHTML(term)}</section>
    </div>`;

  panelEl.querySelector('#td-close').addEventListener('click', close);
  panelEl.querySelectorAll('.td-shortcut').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt || '';
      window.dispatchEvent(new CustomEvent('open-prompt-modal', { detail: { basePrompt: prompt, topicName: term, name: btn.dataset.name, iconKey: btn.dataset.icon, count: 1 } }));
    });
  });

  overlayEl.style.display = 'block';
  panelEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  panelEl.scrollTop = 0;
}

function close() {
  overlayEl.style.display = 'none';
  panelEl.style.display = 'none';
  panelEl.innerHTML = '';
  document.body.style.overflow = '';
}
```

- [ ] **Step 2: Init in app.js** — add import `import { initTrendingDetailModal } from './components/trending-detail-modal.js';` and call `initTrendingDetailModal();` next to the other init calls in the DOMContentLoaded handler.

- [ ] **Step 3: Syntax check** — `node --check js/components/trending-detail-modal.js && node --check js/app.js`.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "Add Trending detail modal component"`

---

### Task 5: Trending row → open modal

**Files:** Modify `js/components/trending.js`

- [ ] **Step 1:** Change `rowHTML(topic)` to a button that dispatches the event with the full item instead of an `<a href="#/custom/…">`:

```js
function rowHTML(topic) {
  const q = topic.query;
  return `
    <li class="trending-row-item">
      <button type="button" class="trending-row" data-idx="${topic.__idx}" title="Open ${escapeAttr(q)}">
        <span class="trending-row-text">${escapeHTML(q)}</span>
        ${CHEV}
      </button>
    </li>`;
}
```
In `renderTrending`, after fetching, stamp `topics.forEach((t,i)=>{t.__idx=i;})`, render, then wire clicks:
```js
    container.querySelectorAll('.trending-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = topics[Number(btn.dataset.idx)];
        if (t) window.dispatchEvent(new CustomEvent('open-trending-detail', { detail: t }));
      });
    });
```
(Place this wiring where the list is painted; the component renders once now, so wire right after setting innerHTML.)

- [ ] **Step 2: Syntax check** — `node --check js/components/trending.js`.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "Trending rows open the detail modal"`

---

### Task 6: Modal styles

**Files:** Modify `css/styles.css`

- [ ] **Step 1:** Append modal styles (centered overlay; near-full-height scroll on mobile; reuse `.ti-accordion` for the accordions). Key classes: `.td-overlay`, `.td-panel`, `.td-header`, `.td-eyebrow`, `.td-title`, `.td-sub`, `.td-close`, `.td-body`, `.td-related`, `.td-trends-link`, `.td-section`, `.td-section-label`, `.td-shortcut`, `.td-row-name`, `.td-row-desc`, `.td-row-chev`. z-index BELOW the prompt modal (`.prompt-modal-overlay` is 200/201) so the prompt modal stacks above — use overlay 150 / panel 151. Full CSS block provided in implementation.

- [ ] **Step 2: Brace check** — `node -e "const c=require('fs').readFileSync('css/styles.css','utf8');process.exit((c.match(/{/g)||[]).length===(c.match(/}/g)||[]).length?0:1)"`.

- [ ] **Step 3: Browser check** — mocked `/api/trending`, click a row → modal shows term, related, Google Trends link, Trending 101, Trending Intelligence accordions; expand an accordion; click a shortcut → Review & Submit opens above with the term substituted. Desktop + mobile.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "Style Trending detail modal"`

---

### Task 7: Admin — Trending 101 editor

**Files:** Modify `admin.html`

- [ ] **Step 1:** In the Shortcuts tab, add a "Trending 101" sub-section that loads `data/shortcuts-trending101.json` into the admin state, renders a table of rows (id / name / icon / prompt / description) with add/delete, edits via input delegation, and is included in "Export changed files" so it downloads `shortcuts-trending101.json`. Mirror the existing evergreen/prompt-gen editor wiring (`data.<key>`, dirty-tracking, `dlJSON`). Full markup + handlers provided in implementation.

- [ ] **Step 2: Verify** — open `admin.html` (served), Shortcuts tab shows the 4 Trending 101 rows, editing marks dirty, Export downloads the file.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "Admin: Trending 101 editor"`

---

### Task 8: Verify + deploy

- [ ] **Step 1:** Full browser pass (desktop + mobile) with mocked trending: row → modal, all sections, shortcut → prompt modal, sidebar TI still works (parity).
- [ ] **Step 2:** `node tools/test_trending_normalize.mjs` passes.
- [ ] **Step 3:** Commit anything outstanding; `git push origin main`. Verify live (the real `/api/trending` now includes `trendBreakdown`/`googleTrendsUrl`).

---

## Notes
- The modal reuses `open-prompt-modal`; the prompt modal anchors to the home sidebar or centers — both fine while the trending modal sits beneath.
- Trending 101 shortcuts are intentionally separate from the directory so they never appear in normal topic sidebars.

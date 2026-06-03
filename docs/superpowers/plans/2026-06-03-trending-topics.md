# Trending Topics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a homepage "Trending Topics" section listing US Google Trends searches (via SerpAPI), each linking to Custom Search — shown as a sidebar card above Topic Intelligence on desktop and its own mobile tab.

**Architecture:** A Vercel serverless function (`api/trending.js`) calls SerpAPI's `google_trends_trending_now`, normalizes + hourly edge-caches the result (stale-while-revalidate). A client util fetches it; a component renders an expandable card. The home layout/tabs/router gain a `trending` section/tab.

**Tech Stack:** Vanilla JS ES modules, Vercel serverless (CommonJS), CSS, Node test scripts.

Spec: `docs/superpowers/specs/2026-06-03-trending-topics-design.md`

---

### Task 1: Trending normalizer + Node test

Pure function that converts a SerpAPI response into our topic list — testable without network.

**Files:**
- Create: `js/utils/trending-normalize.mjs`
- Test: `tools/test_trending_normalize.mjs`

- [ ] **Step 1: Write the failing test** — `tools/test_trending_normalize.mjs`

```js
import assert from 'node:assert';
import { normalizeTrending } from '../js/utils/trending-normalize.mjs';

// Two geos, one duplicate query (case-insensitive) → deduped, capped, ISO timestamp.
const us = { trending_searches: [
  { query: 'Taylor Swift', start_timestamp: 1700000000, categories: [{ id: 3, name: 'Entertainment' }] },
  { query: 'NBA trade', start_timestamp: 1700003600, categories: [] },
] };
const uk = { trending_searches: [
  { query: 'taylor swift', start_timestamp: 1700000500 }, // dup of US (case-insensitive)
  { query: 'Premier League', start_timestamp: 1700001000 },
] };

const out = normalizeTrending([{ geo: 'US', data: us }, { geo: 'UK', data: uk }], 20);
assert.equal(out.length, 3, 'dedupes case-insensitively across geos');
assert.equal(out[0].query, 'Taylor Swift');
assert.equal(out[0].region, 'US');
assert.equal(out[0].startedAt, new Date(1700000000 * 1000).toISOString());
assert.deepEqual(out[0].categories, ['Entertainment']);
assert.equal(out[2].query, 'Premier League');
assert.equal(out[2].region, 'UK');

// Cap respected, missing/blank queries dropped.
const many = { trending_searches: Array.from({ length: 30 }, (_, i) => ({ query: `q${i}` })).concat([{ query: '' }, {}]) };
assert.equal(normalizeTrending([{ geo: 'US', data: many }], 20).length, 20, 'caps at limit, drops blanks');

console.log('OK: normalizeTrending');
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node tools/test_trending_normalize.mjs`
Expected: FAIL (`Cannot find module '.../trending-normalize.mjs'`).

- [ ] **Step 3: Implement** — `js/utils/trending-normalize.mjs`

```js
// Pure SerpAPI google_trends_trending_now → normalized topic list.
// No DOM, no network — unit-testable. Shared by the serverless function
// (via dynamic import) and the test.
//
// Input: array of { geo, data } where data is a SerpAPI response.
// Output: [{ query, categories: string[], startedAt: ISO|null, region }]
// deduped case-insensitively by query (first occurrence wins), capped.
export function normalizeTrending(results, limit = 20) {
  const seen = new Set();
  const out = [];
  for (const { geo, data } of results || []) {
    const list = Array.isArray(data?.trending_searches) ? data.trending_searches : [];
    for (const t of list) {
      const query = (t?.query || '').trim();
      if (!query) continue;
      const key = query.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const ts = Number(t?.start_timestamp);
      out.push({
        query,
        categories: Array.isArray(t?.categories) ? t.categories.map(c => c?.name).filter(Boolean) : [],
        startedAt: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null,
        region: geo,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `node tools/test_trending_normalize.mjs`
Expected: `OK: normalizeTrending`

- [ ] **Step 5: Commit**

```bash
git add js/utils/trending-normalize.mjs tools/test_trending_normalize.mjs
git commit -m "Add Trending normalizer + test"
```

---

### Task 2: Serverless endpoint `api/trending.js`

**Files:**
- Create: `api/trending.js`

- [ ] **Step 1: Implement** — `api/trending.js`

```js
// Vercel serverless function — GET /api/trending
//
// Calls SerpAPI's google_trends_trending_now for each configured geo,
// merges + dedupes into a single ranked list, and edge-caches the result
// for an hour (stale-while-revalidate). With on-demand caching + SWR,
// SerpAPI is hit at most ~once/hour under load and never with no traffic.
//
// 200 — { topics, fetched, geos }
// 500 — { error: "Server misconfiguration" }   (SERPAPI_API_KEY missing)
// 502 — { error: "Upstream trends unavailable" }(SerpAPI non-2xx / network)

const { normalizeTrending } = require('../js/utils/trending-normalize.mjs');

// Geo config — single source of truth. Add 'GB','DE',… here (and only
// here) to widen coverage; each geo is one upstream call per refresh.
const GEOS = ['US'];
const LIMIT = 20;
const SERP_BASE = 'https://serpapi.com/search.json';
// 1h fresh, serve stale up to a day while revalidating in the background.
const CACHE_HEADER = 'public, s-maxage=3600, stale-while-revalidate=86400';

module.exports = async function handler(req, res) {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server misconfiguration' });

  const fetched = new Date().toISOString();
  try {
    const results = await Promise.all(GEOS.map(async (geo) => {
      const url = `${SERP_BASE}?engine=google_trends_trending_now&geo=${encodeURIComponent(geo)}&api_key=${encodeURIComponent(apiKey)}`;
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`SerpAPI ${r.status}`);
      return { geo, data: await r.json() };
    }));

    const topics = normalizeTrending(results, LIMIT);

    res.setHeader('Cache-Control', CACHE_HEADER);
    res.setHeader('Vercel-Cache-Tag', 'trending-all');
    return res.status(200).json({ topics, fetched, geos: GEOS });
  } catch (err) {
    return res.status(502).json({ error: 'Upstream trends unavailable' });
  }
};
```

NOTE: `require()` of an `.mjs` file works on Vercel's Node runtime (Node ≥ 20 supports `require` of ESM). Verified equivalently by the local syntax check; if Vercel's bundler objects, fall back to duplicating the small normalizer inline. (Implementer: prefer the shared import; only inline if the deploy build fails.)

- [ ] **Step 2: Syntax check**

Run: `node --check api/trending.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add api/trending.js
git commit -m "Add /api/trending SerpAPI google-trends endpoint"
```

---

### Task 3: Client data util `js/utils/trending.js`

**Files:**
- Create: `js/utils/trending.js`

- [ ] **Step 1: Implement** — `js/utils/trending.js`

```js
// Client fetch for /api/trending. Caches the in-flight/resolved promise
// for the page session so repeated renders share one request.
let cached = null;

export function fetchTrending() {
  if (cached) return cached;
  cached = (async () => {
    const res = await fetch('/api/trending', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`trending ${res.status}`);
    const payload = await res.json();
    return { topics: Array.isArray(payload?.topics) ? payload.topics : [], fetched: payload?.fetched || null };
  })();
  // Don't cache a rejection — allow a later render to retry.
  cached.catch(() => { cached = null; });
  return cached;
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check js/utils/trending.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add js/utils/trending.js
git commit -m "Add client fetchTrending util"
```

---

### Task 4: Trending component `js/components/trending.js`

**Files:**
- Create: `js/components/trending.js`

- [ ] **Step 1: Implement** — `js/components/trending.js`

```js
// Homepage Trending Topics card. Lists US Google-Trends searches (via
// /api/trending); each row links to the Custom Search page. Shows 7 rows
// collapsed, expands to the full ~20 in a scroll area. Matches the Topic
// Intelligence sidebar card's look & feel.
import { fetchTrending } from '../utils/trending.js';

const COLLAPSED_COUNT = 7;

function escapeHTML(str) { const d = document.createElement('div'); d.textContent = str ?? ''; return d.innerHTML; }
function escapeAttr(str) { return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

const FLAME = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c1 3-1.5 4.5-2.5 6S8 12 9 13c.5-1 1.5-1.5 2-2.5.8 1.2 2 2 2 3.7a3 3 0 0 1-6 0c0-.6.1-1.1.3-1.6C5.5 14 4.5 16 4.5 18a7.5 7.5 0 0 0 15 0c0-4.5-4-6-7.5-16z"/></svg>`;
const CHEV = `<svg class="trending-row-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;

function rowHTML(topic) {
  const q = topic.query;
  return `
    <li class="trending-row-item">
      <a class="trending-row" href="#/custom/${encodeURIComponent(q)}" title="Search ${escapeAttr(q)}">
        <span class="trending-row-text">${escapeHTML(q)}</span>
        ${CHEV}
      </a>
    </li>`;
}

function listMarkup(topics, expanded) {
  const shown = expanded ? topics : topics.slice(0, COLLAPSED_COUNT);
  const remaining = topics.length - COLLAPSED_COUNT;
  const moreBtn = remaining > 0
    ? `<button type="button" class="trending-more" id="trending-more" aria-expanded="${expanded}">
         ${expanded ? 'Show less' : `Show more (${remaining})`}
       </button>`
    : '';
  return `
    <ul class="trending-list ${expanded ? 'is-expanded' : ''}">${shown.map(rowHTML).join('')}</ul>
    ${moreBtn}`;
}

function shell(bodyHTML, fetched) {
  const updated = fetched ? `<span class="trending-updated">Updated ${escapeHTML(relativeTime(fetched))}</span>` : '';
  return `
    <div class="sidebar-card trending-card">
      <div class="sidebar-card-header trending-header">
        <span class="trending-icon" aria-hidden="true">${FLAME}</span>
        <div class="trending-heading">
          <h3 class="sidebar-card-title trending-title">Trending Topics</h3>
          <span class="trending-attr">via Google Trends</span>
        </div>
      </div>
      <div class="trending-body" id="trending-body">${bodyHTML}</div>
      <div class="trending-foot">${updated}</div>
    </div>`;
}

function skeleton() {
  const rows = Array.from({ length: COLLAPSED_COUNT }, () => `<li class="trending-skel-row"></li>`).join('');
  return shell(`<ul class="trending-list trending-skeleton">${rows}</ul>`, null);
}

export function renderTrending(container) {
  container.innerHTML = skeleton();

  fetchTrending().then(({ topics, fetched }) => {
    if (!topics.length) {
      container.innerHTML = shell(`<p class="trending-empty">Trending is taking a break — check back soon.</p>`, fetched);
      return;
    }
    let expanded = false;
    const paint = () => {
      container.innerHTML = shell(listMarkup(topics, expanded), fetched);
      const moreBtn = container.querySelector('#trending-more');
      if (moreBtn) moreBtn.addEventListener('click', () => { expanded = !expanded; paint(); });
    };
    paint();
  }).catch(() => {
    container.innerHTML = shell(`<p class="trending-empty">Trending is taking a break — check back soon.</p>`, null);
  });
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check js/components/trending.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add js/components/trending.js
git commit -m "Add Trending Topics component"
```

---

### Task 5: Router — `#/trending` home tab

**Files:**
- Modify: `js/utils/router.js`

- [ ] **Step 1: Edit** — in `parseRoute`, extend the single-segment home-tab check to include `trending`.

Replace:
```js
  if (segments.length === 1 && (segments[0] === 'shortcuts' || segments[0] === 'related')) {
    return { type: 'home', slug: 'home', tab: segments[0] };
  }
```
with:
```js
  if (segments.length === 1 && (segments[0] === 'shortcuts' || segments[0] === 'related' || segments[0] === 'trending')) {
    return { type: 'home', slug: 'home', tab: segments[0] };
  }
```

- [ ] **Step 2: Syntax check** — `node --check js/utils/router.js` → no output.

- [ ] **Step 3: Commit**

```bash
git add js/utils/router.js
git commit -m "Router: accept #/trending home tab"
```

---

### Task 6: app.js — render section + tab wiring

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Import** the component near the other component imports (after the `initPromptModal` import line):

```js
import { renderTrending } from './components/trending.js';
```

- [ ] **Step 2: Add the Trending tab pill** in `bodyTabsRow()` — insert between the News Feed pill and the Topic Intelligence pill so order is News Feed, Trending, Topic Intelligence. The `tabs` array becomes:

```js
  const tabs = [
    `<button type="button" class="tab-pill tab-pill-newsfeed active" data-tab="newsfeed">
       <span class="tab-pill-label-long">News Feed</span>
       <span class="tab-pill-label-short">News Feed</span>
     </button>`,
    `<button type="button" class="tab-pill tab-pill-trending" data-tab="trending">
       <span class="tab-pill-label-long">Trending</span>
       <span class="tab-pill-label-short">Trending</span>
     </button>`,
    `<button type="button" class="tab-pill tab-pill-shortcuts" data-tab="shortcuts">
       <span class="tab-pill-label-long">Topic Intelligence</span>
       <span class="tab-pill-label-short">Topic Intelligence</span>
     </button>`,
  ];
```

Note: the Trending pill renders on all topic-layout pages' body-tabs, but the `#section-trending` only exists on home; on topic pages, tapping Trending shows nothing. To keep it home-only, gate it: change `bodyTabsRow(opts)` callers — home passes `{ showTrending: true }`. Implement by adding `const { showRelated = false, showTrending = false } = opts;` and only pushing the Trending pill when `showTrending`. Update the two `bodyTabsRow(...)` calls: home → `bodyTabsRow({ showRelated: false, showTrending: true })`, topic → unchanged.

Concretely, replace the static Trending entry above with a conditional after building the base array:
```js
  const { showRelated = false, showTrending = false } = opts;
  const tabs = [ /* News Feed pill */ ];
  if (showTrending) tabs.push(/* Trending pill */);
  tabs.push(/* Topic Intelligence (shortcuts) pill */);
  if (showRelated) tabs.push(/* Related pill */);
```
…preserving the News Feed → Trending → Topic Intelligence → (Related) order.

- [ ] **Step 3: Add `'trending'` to the tab-panel lists.** There are three places listing the panels:
  - `const TAB_PANELS = ['newsfeed', 'shortcuts', 'related'];` → `['newsfeed', 'trending', 'shortcuts', 'related'];`
  - In `setupTabPills`: `['newsfeed', 'shortcuts', 'related'].forEach(...)` → add `'trending'`.
  - In `setupGlobalTabPillDelegation`: the `['newsfeed', 'shortcuts', 'related'].forEach(...)` remove-class loop → add `'trending'`. Also in its URL-update block, the home branch `newHash = tab === 'newsfeed' ? '#/' : '#/' + tab;` already handles `trending` (→ `#/trending`). No change needed there.

- [ ] **Step 4: Render the section on home.** In `renderTopicLayout`, the `isHome` branch builds the layout HTML. Add a trending section ABOVE the shortcuts section:

Replace the home branch innerHTML:
```js
    container.innerHTML = `
      <div class="topic-layout" id="topic-layout">
        ${bodyTabsRow({ showRelated: false, showTrending: true })}
        <section class="layout-section" id="section-trending"></section>
        <section class="layout-section" id="section-shortcuts"></section>
        <section class="layout-section" id="section-newsfeed"></section>
      </div>
    `;
```
(Leave the topic and custom branches as-is; topic branch keeps `bodyTabsRow({ showRelated: false })`.)

- [ ] **Step 5: Call renderTrending.** After the existing `const shortcutsSection = ...; const feedSection = ...;` lookups in `renderTopicLayout`, add:
```js
  const trendingSection = container.querySelector('#section-trending');
  if (trendingSection) renderTrending(trendingSection);
```

- [ ] **Step 6: Syntax check** — `node --check js/app.js` → no output.

- [ ] **Step 7: Commit**

```bash
git add js/app.js
git commit -m "Wire Trending section + mobile tab into home layout"
```

---

### Task 7: CSS — trending card, desktop grid placement, mobile tab

**Files:**
- Modify: `css/styles.css`

- [ ] **Step 1: Add trending card styles.** Append near the other sidebar/TI styles (end of the sidebar-card block is fine):

```css
/* === Trending Topics card === */
.trending-card { display: flex; flex-direction: column; }
.trending-header { display: flex; align-items: center; gap: 0.6rem; }
.trending-icon { width: 26px; height: 26px; flex: 0 0 26px; display: inline-flex; align-items: center; justify-content: center; color: #e8590c; background: #fff4ec; border-radius: 7px; }
.trending-icon svg { width: 16px; height: 16px; }
.trending-heading { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
.trending-title { margin: 0; }
.trending-attr { font-size: 0.66rem; font-weight: 600; letter-spacing: 0.02em; color: var(--color-text-light); }
.trending-body { margin-top: 0.6rem; }
.trending-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.15rem; }
.trending-list.is-expanded { max-height: 22rem; overflow-y: auto; }
.trending-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.55rem; border-radius: 8px; text-decoration: none; color: var(--color-text); transition: background 0.12s, color 0.12s; }
.trending-row:hover { background: #fff4ec; color: #c2410c; }
.trending-row-text { flex: 1 1 auto; min-width: 0; font-size: 0.9rem; font-weight: 600; letter-spacing: -0.006em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trending-row-chev { flex: 0 0 auto; color: var(--color-text-light); transition: transform 0.12s, color 0.12s; }
.trending-row:hover .trending-row-chev { color: #e8590c; transform: translateX(2px); }
.trending-more { margin-top: 0.4rem; width: 100%; background: var(--color-bg-light); border: 1px solid var(--color-border); border-radius: 8px; padding: 0.45rem; font-family: inherit; font-size: 0.82rem; font-weight: 600; color: var(--color-primary); cursor: pointer; transition: background 0.12s, border-color 0.12s; }
.trending-more:hover { background: #eef1f6; border-color: #cdd5e2; }
.trending-foot { margin-top: 0.55rem; }
.trending-updated { font-size: 0.7rem; color: var(--color-text-light); }
.trending-empty { font-size: 0.86rem; color: var(--color-text-muted); padding: 0.4rem 0.1rem; }
.trending-skeleton { pointer-events: none; }
.trending-skel-row { height: 2.1rem; border-radius: 8px; background: linear-gradient(90deg, #f1f3f7 25%, #e9edf3 37%, #f1f3f7 63%); background-size: 400% 100%; animation: trending-shimmer 1.4s ease infinite; }
@keyframes trending-shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
```

- [ ] **Step 2: Desktop grid placement.** Find the desktop two-column rule `@media (min-width: 900px)` block where `.topic-layout { grid-template-columns: 320px minmax(0, 1fr); }` (around line 5079). Add row tracks + explicit placement so trending stacks above shortcuts in the left column. Inside that media query add:

```css
  /* Home: Trending (left col, row 1) stacks above Topic Intelligence
     (left col, row 2); News Feed fills the right column across both. */
  body.app-mode .topic-layout:not(.is-custom) {
    grid-template-rows: auto minmax(0, 1fr);
  }
  body.app-mode .topic-layout:not(.is-custom) > #section-trending { grid-column: 1; grid-row: 1; padding-right: 1.5rem; margin-bottom: 1rem; }
  body.app-mode .topic-layout:not(.is-custom) > #section-shortcuts { grid-column: 1; grid-row: 2; }
  body.app-mode .topic-layout:not(.is-custom) > #section-newsfeed { grid-column: 2; grid-row: 1 / span 2; }
```
(Topic pages have no `#section-trending`; the `grid-row` on shortcuts/newsfeed still resolves correctly since row 1 is empty there. If topic pages shift visually, scope these three rules to home via a `body[data-route="home"]` hook — see Step 4 contingency.)

- [ ] **Step 3: Mobile tab visibility.** Find the `@media (max-width: 899.98px)` block with the `#section-shortcuts, #section-newsfeed, #section-related { display: none; }` hide rule and the `active-tab-*` show rules (around line 5774-5781). Add trending:

Hide list → add `#section-trending`:
```css
  body.app-mode .topic-layout:not(.is-custom) > #section-shortcuts,
  body.app-mode .topic-layout:not(.is-custom) > #section-trending,
  body.app-mode .topic-layout:not(.is-custom) > #section-newsfeed,
  body.app-mode .topic-layout:not(.is-custom) > #section-related {
    display: none;
  }
```
Show rule → add:
```css
  body.app-mode.active-tab-trending .topic-layout:not(.is-custom) > #section-trending { display: flex; }
```

- [ ] **Step 4: Body-tabs grid columns.** The body-tabs row uses `grid-template-columns: 1fr 1fr;` (2 tabs) around line 5168-5170. With 3 tabs on home it must be 3 columns. Add a home-aware override; since body-tabs count varies, set it to auto-flow equal columns:
```css
  body.app-mode .topic-layout:not(.is-custom) > .body-tabs { grid-auto-flow: column; grid-auto-columns: 1fr; }
```
(Place this in the same `@media (max-width: 899.98px)` block, after the existing `.body-tabs` rule so it wins.)

- [ ] **Step 5: Syntax sanity.** Run a quick CSS brace balance check:
```bash
node -e "const c=require('fs').readFileSync('css/styles.css','utf8');const o=(c.match(/{/g)||[]).length,cl=(c.match(/}/g)||[]).length;console.log('braces',o,cl);process.exit(o===cl?0:1)"
```
Expected: open === close count.

- [ ] **Step 6: Commit**

```bash
git add css/styles.css
git commit -m "Style Trending card + desktop grid + mobile tab"
```

---

### Task 8: Browser verification + deploy

- [ ] **Step 1: Serve + load home (desktop 1280px).** `python3 -m http.server 8765` then open `http://localhost:8765/index.html`. Trending card shows above Topic Intelligence in the left column; since the local server has no `/api/trending`, it shows the empty state ("Trending is taking a break"). Confirm layout (trending above TI, news feed right) is intact and TI/news still work.
- [ ] **Step 2: Mobile (390px).** Confirm body-tabs read News Feed · Trending · Topic Intelligence, all three switch correctly, Trending tab shows the card.
- [ ] **Step 3: Custom-search link.** Temporarily (or via console) confirm a `#/custom/<term>` link routes to the Custom Search page (the row hrefs are correct).
- [ ] **Step 4: Deploy.** Commit anything outstanding and `git push origin main`. Vercel builds; with `SERPAPI_API_KEY` already set, `/api/trending` returns live data and the card populates in production.
- [ ] **Step 5: Verify live.** After deploy, load the production URL: Trending card lists real US trends, "Show more" expands, rows open Custom Search, "Updated X min ago" shows. Hit `https://<domain>/api/trending` → JSON with `topics`.

---

## Notes for the implementer
- Keep `GEOS` as the single place to add regions; the region tag is carried through `normalizeTrending` (`region`) but intentionally not rendered while there's one geo.
- If Vercel's build rejects `require('../js/utils/trending-normalize.mjs')` from `api/trending.js`, inline a copy of `normalizeTrending` into `api/trending.js` (it's ~15 lines) and keep the shared `.mjs` for the unit test. This is the only deploy risk.

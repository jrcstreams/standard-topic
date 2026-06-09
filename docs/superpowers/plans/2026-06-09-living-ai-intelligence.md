# Living "AI Intelligence" Component — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static "AI Intelligence" lens rows + takeover-modal with a living, in-place, flip-navigated component (paths → sections → content), backed by per-path generation with tier-aware refresh-on-view so hot topics stay ~hourly-fresh at near-zero cost.

**Architecture:** Paths map 1:1 to the existing shortcut `group` field (discover→Now, topic-specific→For This Topic, analyze→Analyze, learn→Learn). Generation stays one grounded query per (topic, group) — unchanged. New: a path-metadata config (label/subtitle/refresh class), a per-topic `tier`, an on-read staleness check that background-refreshes stale paths (`waitUntil`), a new front-end component, and a 30/70 topic layout (already shipped).

**Tech stack:** Vanilla JS ES modules (browser) + Node CJS (Vercel serverless), Neon Postgres, Gemini via `lib/insight-core.js`, `@vercel/functions` for `waitUntil`. No unit-test framework — verification is `node --check` + live Playwright browser checks against production after deploy, per existing project convention.

**Conventions (do not skip):**
- Cache-bust: when a JS module changes, bump its `?v=` in `js/app.js`'s import AND bump `app.js` + `css/styles.css` in `index.html`. New revamp tag per deploy (`20260609-revampNN`).
- "Deploy = live": every task that ships commits to `main` (→ Vercel production) and verifies on standardtopic.com before being marked done.
- Reuse: `renderBriefBody` (newsfeed.js), `splitSections` pattern (insight-modal.js), the trending self-heal pattern (api/trending.js) for refresh-on-view.

---

## File structure

- **Create** `data/ai-paths.json` — path metadata (group→label/subtitle/order/refreshClass) + refresh-window table.
- **Create** `lib/ai-freshness.js` (CJS) — pure window calc: `effectiveWindowHours(group, tier)`. Shared by insight endpoint + cron.
- **Create** `js/utils/ai-paths.js` (ESM) — browser getter for `data/ai-paths.json`.
- **Create** `js/components/ai-intelligence.js` (ESM) — the living component (state machine).
- **Modify** `data/topics.json` — add `tier` to each topic.
- **Modify** `api/insight.js` — on-read staleness → background refresh.
- **Modify** `api/cron/pregenerate.js` — tier/class-aware refresh windows + `home` hourly pre-warm note.
- **Modify** `js/app.js` — render the new component on topic/home/search instead of the lens rows; import wiring + cache-bust.
- **Modify** `css/styles.css` — component styles (paths grid, flip states, section menu, content view, responsive).
- **Modify** `index.html` — cache-bust bumps per deploy.

Build sequence below is ordered so each phase is independently shippable and verifiable.

---

## Phase 1 — Path config + freshness math (server-safe, no UI yet)

### Task 1: Path metadata config

**Files:**
- Create: `data/ai-paths.json`

- [ ] **Step 1: Write the config**

```json
{
  "paths": [
    { "group": "discover",       "label": "Now",            "subtitle": "What's happening right now.",            "order": 1, "refreshClass": "live" },
    { "group": "topic-specific", "label": "For This Topic", "subtitle": "Insights tailored to this topic.",       "order": 2, "refreshClass": "live" },
    { "group": "analyze",        "label": "Analyze",        "subtitle": "Deeper analytical lenses and tradeoffs.","order": 3, "refreshClass": "slow" },
    { "group": "learn",          "label": "Learn",          "subtitle": "Background, fundamentals, and context.", "order": 4, "refreshClass": "evergreen" }
  ],
  "windows": {
    "live":      { "1": 1, "2": 6, "3": 18 },
    "slow":      168,
    "evergreen": 720
  }
}
```

- [ ] **Step 2: Validate** — `node -e "JSON.parse(require('fs').readFileSync('data/ai-paths.json','utf8')); console.log('ok')"` → `ok`
- [ ] **Step 3: Commit** — `git add data/ai-paths.json && git commit -m "feat: AI path metadata + refresh windows config"`

### Task 2: Per-topic tier

**Files:**
- Modify: `data/topics.json`

- [ ] **Step 1: Add `tier` to every topic.** Default: top-level (`parent === null`) → `1`, subtopic → `3`. Apply with a one-off script, then hand-bump a few busy subtopics to `2` later via admin (out of scope here).

```bash
node -e '
const fs=require("fs"); const p="data/topics.json"; const d=JSON.parse(fs.readFileSync(p,"utf8"));
d.topics=d.topics.map(t=> t.slug==="home" ? t : ({...t, tier: t.tier ?? (t.parent===null?1:3)}));
fs.writeFileSync(p, JSON.stringify(d,null,2)+"\n");
console.log("tiered", d.topics.filter(t=>t.tier).length);
'
```

- [ ] **Step 2: Verify** — `node -e "const t=require('./data/topics.json').topics; console.log(t.filter(x=>x.tier===1).length,'tier1', t.filter(x=>x.tier===3).length,'tier3')"` → ~14 tier1, ~85 tier3.
- [ ] **Step 3: Commit** — `git commit -am "feat: per-topic AI freshness tier (default top-level=1, subtopic=3)"`

### Task 3: Freshness window calculator (server)

**Files:**
- Create: `lib/ai-freshness.js`

- [ ] **Step 1: Implement**

```js
// Pure: effective refresh window (hours) for a (group, tier). Shared by the
// insight endpoint (refresh-on-view) and the pregenerate cron.
const cfg = require('../data/ai-paths.json');
const BY_GROUP = Object.fromEntries(cfg.paths.map((p) => [p.group, p]));

function refreshClass(group) { return (BY_GROUP[group] && BY_GROUP[group].refreshClass) || 'slow'; }

function effectiveWindowHours(group, tier) {
  const cls = refreshClass(group);
  if (cls === 'live') return cfg.windows.live[String(tier || 3)] ?? cfg.windows.live['3'];
  if (cls === 'evergreen') return cfg.windows.evergreen;
  return cfg.windows.slow;
}

module.exports = { effectiveWindowHours, refreshClass, PATHS: cfg.paths };
```

- [ ] **Step 2: Verify** — `node -e "const f=require('./lib/ai-freshness'); console.log(f.effectiveWindowHours('discover',1), f.effectiveWindowHours('discover',3), f.effectiveWindowHours('learn',1))"` → `1 18 720`
- [ ] **Step 3: Commit** — `git commit -am "feat: lib/ai-freshness window calculator"`

---

## Phase 2 — Refresh-on-view (server)

### Task 4: On-read staleness → background regen in /api/insight

**Files:**
- Modify: `api/insight.js`
- Reference: `api/trending.js` (the self-heal `waitUntil` pattern), `lib/insight-core.js` (`generateInsight` returns `{cached, generatedAt}`)

- [ ] **Step 1:** At the top of `api/insight.js`, lazily import `waitUntil` (guarded, same as `api/trending.js`) and the topics data + freshness calc:

```js
let waitUntil; try { ({ waitUntil } = require('@vercel/functions')); } catch (e) { waitUntil = null; }
const { effectiveWindowHours } = require('../lib/ai-freshness');
const topicsData = require('../data/topics.json');
function tierForTopic(name) {
  const t = (topicsData.topics || []).find((x) => (x.name || '').toLowerCase() === String(name || '').toLowerCase());
  return (t && t.tier) || 3;
}
```

- [ ] **Step 2:** After the handler computes the insight result for a `shortcut` request and it's cached, check staleness and fire a non-blocking refresh. (Read the current handler first; insert after the cached result is obtained, before responding.)

```js
// d = parsed request body; result = await generateInsight(sql, d)
if (d.type === 'shortcut' && result && result.cached && result.generatedAt && waitUntil) {
  const ageH = (Date.now() - new Date(result.generatedAt).getTime()) / 36e5;
  const windowH = effectiveWindowHours(d.group, tierForTopic(d.topic));
  if (ageH >= windowH) {
    waitUntil((async () => { try { await generateInsight(sql, { ...d, refresh: 1 }); } catch (_) {} })());
  }
}
```

- [ ] **Step 3: Verify** — `node --check api/insight.js`. Then deploy + on a topic, open a path whose `created_at` is older than its window; confirm via DB or a second load that `generatedAt` advanced (background refresh ran). Cap: it serves the stale copy on the first hit (expected), fresh on next.
- [ ] **Step 4: Commit** — `git commit -am "feat: refresh-on-view — stale AI paths regenerate in the background"`

### Task 5: Tier/class-aware refresh in the cron + home pre-warm

**Files:**
- Modify: `api/cron/pregenerate.js`
- Modify: `vercel.json` (only if changing cron cadence)

- [ ] **Step 1:** Replace the hardcoded refresh windows in the stale-selection query (the `interval '72 hours'` / `'168 hours'` arms) so shortcut refresh uses the per-(group,tier) window from `lib/ai-freshness`. Since SQL can't easily call JS per-row, compute in JS: select candidate shortcut rows with `created_at`, then in the loop skip any whose age < `effectiveWindowHours(group, tier)`. (Group = `insight`; tier via topic name lookup.)
- [ ] **Step 2:** Ensure `home` scope is refreshed every run (it's always-on). Add `home` to the front of the fill/refresh candidate order if stale per its windows.
- [ ] **Step 3:** Confirm cron cadence: keep `15 */3 * * *` (the home pre-warm + on-view handle hot freshness). Only tighten to hourly if home freshness needs it; note the decision inline.
- [ ] **Step 4: Verify** — `node --check api/cron/pregenerate.js`; trigger the cron manually (`?type=refresh`) against prod and confirm the response counts look sane.
- [ ] **Step 5: Commit** — `git commit -am "feat: pregenerate uses per-path/tier windows + home pre-warm"`

---

## Phase 3 — The living component

### Task 6: Browser path-config getter

**Files:**
- Create: `js/utils/ai-paths.js`
- Modify: `js/utils/data.js` (load `ai-paths.json` alongside other data, or fetch directly)

- [ ] **Step 1:** Export `getAIPaths()` returning the ordered `paths` array from `data/ai-paths.json` (fetch once, cache; follow how `data.js` loads other JSON).
- [ ] **Step 2: Verify** — `node --check js/utils/ai-paths.js`.
- [ ] **Step 3: Commit** — `git commit -m "feat: browser getter for AI path metadata"`

### Task 7: The component — state machine + render

**Files:**
- Create: `js/components/ai-intelligence.js`
- Reference: `js/components/insight-modal.js` (`splitSections`, `renderBriefBody` import, the explore-further flow), `js/components/newsfeed.js` (`renderBriefBody`)

- [ ] **Step 1: Implement the component.** Skeleton (fill brief bodies + explore via the existing helpers):

```js
import { renderBriefBody } from './newsfeed.js';
import { getAIPaths } from '../utils/ai-paths.js';

// scope: { topic: '<Topic Name>'|'home'|<customTerm>, label: '<display>' }
export function renderAIIntelligence(container, scope) {
  const paths = getAIPaths();
  const cache = {};            // group -> { sections:[{name,body}], generatedAt, sources }
  let view = 'paths';          // 'paths' | 'sections' | 'content'
  let curPath = null, curSection = null;

  function relTime(iso){ /* same impl as insight-modal.js */ }
  function splitSections(content){ /* same impl as insight-modal.js */ }

  async function loadPath(group){
    if (cache[group]) return cache[group];
    const p = paths.find(x=>x.group===group);
    const res = await fetch('/api/insight', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ type:'shortcut', topic: scope.topic, group }) });
    const data = res.ok ? await res.json() : null;
    cache[group] = data && data.content
      ? { sections: splitSections(data.content), generatedAt: data.generatedAt, sources: data.sources||[] }
      : { sections: [], generatedAt: null, sources: [] };
    return cache[group];
  }

  function render(){
    if (view === 'paths') return renderPaths();
    if (view === 'sections') return renderSections();
    return renderContent();
  }
  function renderPaths(){ /* grid of path tiles: label + subtitle; click → curPath=group, view='sections', loadPath+render */ }
  function renderSections(){ /* header: label · scope + Back + "Updated <relTime(generatedAt)>"; jump-menu of section names; click → curSection, view='content' */ }
  function renderContent(){ /* Back; section name; renderBriefBody(curSection.body); "Explore further with AI" control */ }

  render();
  return { destroy(){ container.innerHTML=''; } };
}
```

- [ ] **Step 2:** Implement `renderPaths/renderSections/renderContent` with a flip/slide class toggle between states and a back walk (`content→sections→paths`). Loading state while `loadPath` is in flight. Section content + a reusable "Explore further with AI" (reuse the model/prompt flow — extract the explore sub-flow from `insight-modal.js` into a shared export `wireExplore(el, {prompt})`, or dispatch `open-prompt-modal`).
- [ ] **Step 3: Verify** — `node --check js/components/ai-intelligence.js`.
- [ ] **Step 4: Commit** — `git commit -m "feat: living AI Intelligence component (paths→sections→content state machine)"`

### Task 8: Extract a shared "Explore further with AI" helper

**Files:**
- Modify: `js/components/insight-modal.js` (export the explore flow), or Create a small `js/components/explore-further.js`
- Use in: `ai-intelligence.js`

- [ ] **Step 1:** Factor the Choose-Model → Direct/Review flow (currently `exploreChooseHTML`/`exploreSubmitHTML`/wiring in insight-modal.js) into a reusable exported function `mountExplore(containerEl, { prompt, onReview })`. Keep insight-modal.js using it (no behavior change).
- [ ] **Step 2:** Use `mountExplore` in the component's content view.
- [ ] **Step 3: Verify** — `node --check` both files; after deploy, confirm Explore-further still works in the news/trend/overview modals AND in the new component.
- [ ] **Step 4: Commit** — `git commit -m "refactor: shared Explore-further helper used by modal + AI component"`

---

## Phase 4 — Wire in + style + ship

### Task 9: Render the component on topic / home / search

**Files:**
- Modify: `js/app.js` (replace the AI Intelligence lens-rows render in `renderShortcutsSidebar`'s AI section with `renderAIIntelligence`, for topic + home + custom scopes), import + cache-bust.

- [ ] **Step 1:** Import `renderAIIntelligence`. In the topic-page path (`#section-shortcuts`) render the component with `{ topic: topicName }`. On home (`'home'` scope) render the homepage version. On search results (custom), render with `{ topic: customTerm }`.
- [ ] **Step 2:** Keep the existing lens-row markup behind nothing — fully replace it. Ensure the open-insight-modal `overview` dispatch is no longer needed for these (navigation is in-component); leave the modal for news/trend.
- [ ] **Step 3:** Cache-bust: bump `ai-intelligence.js`/`insight-modal.js` import versions + `app.js` + `styles.css` in `index.html`.
- [ ] **Step 4: Verify** — `node --check js/app.js`; deploy; on a topic page confirm the component renders in the 70% column, path click loads sections, section click loads content, Back works.
- [ ] **Step 5: Commit + deploy** — commit, `git push origin main`, verify live.

### Task 10: Component CSS (responsive + flip)

**Files:**
- Modify: `css/styles.css`

- [ ] **Step 1:** Add `.aii` block styles: responsive container; `.aii-grid` of path tiles; `.aii-sections` jump-menu; `.aii-content` body; Back control; `Updated` stamp; flip/slide transitions between states (transform + opacity ~0.3s); max-height + internal scroll for very long content; full-width stacking < 900px.
- [ ] **Step 2: Verify** — deploy; live-check at 1280 (70% column), 834 (tablet), 390 (mobile) widths via Playwright: tiles wrap sensibly, flip reads well, content scrolls.
- [ ] **Step 3: Commit + deploy** — verify live.

### Task 11: Homepage placement + "today's world"

**Files:**
- Modify: `js/app.js` (home render), `css/styles.css`

- [ ] **Step 1:** Add the component to the homepage as the `'home'` scope ("today's world"). Decide placement relative to the full-width Trending (e.g., AI Intelligence block above or beside Trending). Keep it from crowding the hero.
- [ ] **Step 2: Verify** — deploy; live-check home shows the living component, paths load, mobile tab/stack still works.
- [ ] **Step 3: Commit + deploy** — verify live.

---

## Phase 5 — Polish & verify the freshness loop end-to-end

### Task 12: End-to-end freshness verification

- [ ] **Step 1:** On a Tier-1 topic (e.g. Politics), open the **Now** path; note the `Updated` stamp. Force-age its row (or wait), reopen → confirm a background refresh fired and the next view shows a newer stamp. Confirm **Learn** does NOT refresh on the same cadence.
- [ ] **Step 2:** Confirm `ai_usage` spend stays flat/near-zero across a browsing session (grounding within free tier) via the admin AI Usage tab.
- [ ] **Step 3:** Confirm on a Tier-3 subtopic the Now window is ~18h (no refresh on rapid reopen).
- [ ] **Step 4: Commit** any tuning (windows/copy) and deploy.

### Task 13: Cleanup

- [ ] **Step 1:** Remove now-dead code paths (the old lens-row rendering / `open-insight-modal` overview dispatch if fully unused), keeping the modal's news/trend paths intact.
- [ ] **Step 2:** `node --check` all touched modules; full live smoke test (topic, home, search, news modal, trend modal still work).
- [ ] **Step 3: Commit + deploy** — final verify live.

---

## Self-review

- **Spec coverage:** living component (T7–8, 9–11), 30/70 (shipped), keep-all-data via group=path (T1, T9), refresh classes × tiers (T1–5), refresh-on-view (T4), home pre-warm (T5), placements (T9, T11). ✓
- **Type consistency:** `group` is the join key everywhere (config `group`, `/api/insight {group}`, `ai_insights.insight`, freshness `effectiveWindowHours(group, tier)`). Path label/subtitle only ever come from `data/ai-paths.json`. ✓
- **Risks called out:** SQL-side per-row window calc done in JS in the cron (T5); Explore-further must keep working in both modal and component (T8); component content height on the narrower topic column (T10 max-height+scroll).
- **No placeholders:** the genuinely new logic (config, freshness calc, on-view refresh, component skeleton) is concrete; render sub-functions (T7 S2) and CSS (T10) are described with explicit acceptance criteria and reuse existing helpers (`renderBriefBody`, `splitSections`, the explore flow).

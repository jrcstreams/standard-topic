# Trend one-liners + inline trend expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a one-sentence AI "why it's trending" summary on every briefed trend (homepage + nav modal), and replace the trend card's inline brief with a richer in-place expansion (sticky header + sources bar + Web/AI Explore accordions + full brief).

**Architecture:** One grounded Gemini call per trend now returns SUMMARY + DETAIL, parsed and stored separately (`ai_insights.summary`). `/api/trending` attaches the stored summary to each list item via one DB lookup. A new `trend-expansion.js` renders the expanded body, reusing `renderBriefBody`, `renderTIAccordion`, `webSourceItem`, `external-searches.json`, and `ai-models.json`.

**Tech Stack:** Vanilla JS ES modules (browser), Node CommonJS (Vercel serverless + lib), Neon Postgres, `node --test` for the one pure-logic unit.

---

## File structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/parse-trend-brief.js` | Create | Pure `parseTrendBrief(raw)` → `{summary, content}` (CommonJS) |
| `test/parse-trend-brief.test.js` | Create | `node --test` unit tests for the parser |
| `package.json` | Modify | Add `"test": "node --test"` |
| `db/schema.sql` | Modify | `ALTER TABLE ai_insights ADD COLUMN IF NOT EXISTS summary TEXT;` |
| `lib/insight-core.js` | Modify | New `trendPrompt` format; parse + store + return `summary` |
| `api/trending.js` | Modify | Join `ai_insights.summary` onto normalized topics |
| `js/components/trending.js` | Modify | Clamped one-liner on card; expansion via new module |
| `js/components/trend-expansion.js` | Create | Render expanded body (header/sources/Web+AI Explore/full) |
| `js/components/newsfeed.js` | Modify | Export `sourceChip` + `resolveSource` for reuse |
| `js/utils/data.js` | (reuse) | `getModels()` for AI Explore |
| `css/styles.css` | Modify | `.trend-exp-*` + sources-bar styles |
| `index.html` | Modify | Bump `?v=` on app.js + styles.css (cache-bust) |

---

## Task 1: SUMMARY/DETAIL parser (pure, TDD)

**Files:**
- Create: `lib/parse-trend-brief.js`
- Test: `test/parse-trend-brief.test.js`
- Modify: `package.json`

- [ ] **Step 1: Add test script to package.json**

In `package.json` `"scripts"`, add:
```json
    "test": "node --test",
```

- [ ] **Step 2: Write the failing test**

Create `test/parse-trend-brief.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseTrendBrief } = require('../lib/parse-trend-brief');

test('splits labeled SUMMARY/DETAIL', () => {
  const raw = 'SUMMARY: Knicks legend back in headlines after a viral clip.\nDETAIL: Stacey King is a former NBA player. He is trending because a broadcast moment went viral. Context follows.';
  const r = parseTrendBrief(raw);
  assert.equal(r.summary, 'Knicks legend back in headlines after a viral clip.');
  assert.ok(r.content.startsWith('Stacey King is a former NBA player.'));
  assert.ok(!/SUMMARY:|DETAIL:/.test(r.content));
});

test('handles extra whitespace and case-insensitive labels', () => {
  const raw = '  summary:   One line here.  \n\n  detail:  Body line one.\nBody line two.';
  const r = parseTrendBrief(raw);
  assert.equal(r.summary, 'One line here.');
  assert.equal(r.content, 'Body line one.\nBody line two.');
});

test('fallback when labels missing: first sentence is summary, full text is content', () => {
  const raw = 'This is the first sentence. This is the second sentence about the trend.';
  const r = parseTrendBrief(raw);
  assert.equal(r.summary, 'This is the first sentence.');
  assert.equal(r.content, raw);
});

test('empty/nullish input yields empty fields', () => {
  assert.deepEqual(parseTrendBrief(''), { summary: '', content: '' });
  assert.deepEqual(parseTrendBrief(null), { summary: '', content: '' });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/parse-trend-brief'`.

- [ ] **Step 4: Implement the parser**

Create `lib/parse-trend-brief.js`:
```js
// Splits a trend brief generation into a one-sentence summary + full body.
// The prompt asks the model for "SUMMARY: <one sentence>\nDETAIL: <body>".
// Falls back to first-sentence-as-summary when the labels are absent so the
// homepage one-liner is never blank for a generated brief.
function firstSentence(s) {
  const m = String(s).match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : String(s)).trim();
}

function parseTrendBrief(raw) {
  const text = String(raw || '').trim();
  if (!text) return { summary: '', content: '' };
  const m = text.match(/summary\s*:\s*([\s\S]*?)\n\s*detail\s*:\s*([\s\S]*)$/i);
  if (m) {
    return { summary: m[1].trim().replace(/\s+/g, ' '), content: m[2].trim() };
  }
  return { summary: firstSentence(text), content: text };
}

module.exports = { parseTrendBrief };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json lib/parse-trend-brief.js test/parse-trend-brief.test.js
git commit -m "feat(trends): SUMMARY/DETAIL brief parser + node:test harness"
```

---

## Task 2: Schema — add summary column

**Files:** Modify `db/schema.sql`

- [ ] **Step 1: Add the column near the other ai_insights ALTERs**

After the `ALTER TABLE ai_insights ADD COLUMN IF NOT EXISTS sources JSONB;` line, add:
```sql
-- Trend one-liner: a single-sentence "why it's trending" distilled from the
-- same grounded generation as `content`. Only trend rows populate it.
ALTER TABLE ai_insights ADD COLUMN IF NOT EXISTS summary TEXT;
```

- [ ] **Step 2: Commit**

```bash
git add db/schema.sql
git commit -m "feat(trends): ai_insights.summary column for trend one-liners"
```

(Migration is run against the live DB in Task 8.)

---

## Task 3: insight-core — new trend prompt + store/return summary

**Files:** Modify `lib/insight-core.js`

- [ ] **Step 1: Import the parser**

Near the other requires at the top:
```js
const { parseTrendBrief } = require('./parse-trend-brief');
```

- [ ] **Step 2: Rewrite `trendPrompt` to request SUMMARY/DETAIL**

Replace the `trendPrompt(query, ctx)` body's leading instruction lines so the model returns two labeled parts (keep the existing context lines for category/breakdown/headlines and the today's-date handling already present):
```js
function trendPrompt(query, ctx) {
  const lines = [
    `You are explaining why a search term is trending RIGHT NOW. Return EXACTLY two labeled parts and nothing else:`,
    `SUMMARY: one sentence (max ~20 words) plainly stating why "${query}" is trending right now.`,
    `DETAIL: 3-5 sentences (plain prose, NO headers/markdown): what it is, why it is trending now (what just happened), and brief context.`,
    `Use Google Search to verify — be specific and factual. If you genuinely cannot tell what it refers to, say so and name the likely category; do NOT invent.`,
    ``,
    `Trending term: "${query}"`,
  ];
  if (ctx.category) lines.push(`Category: ${ctx.category}`);
  if (ctx.breakdown && ctx.breakdown.length) lines.push(`Related searches (strong signal of meaning): ${ctx.breakdown.slice(0, 10).join(', ')}`);
  if (ctx.headlines && ctx.headlines.length) lines.push(`Recent related headlines from our archive:\n- ${ctx.headlines.join('\n- ')}`);
  return lines.join('\n');
}
```

- [ ] **Step 3: Parse trend output + carry `summary` through storage and return**

In `generateInsight`, after the generation block where `out.text` is known and before the upsert, derive content/summary:
```js
  let content = out.text;
  let summary = null;
  if (type === 'trend') {
    const parsed = parseTrendBrief(out.text);
    content = parsed.content || out.text;
    summary = parsed.summary || null;
  }
```
Then use `content` (not `out.text`) in the upsert, and add `summary` to the primary insert. The primary upsert becomes:
```js
    await sql.query(
      `INSERT INTO ai_insights (entity_type, entity_key, insight, content, summary, model, sources)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (entity_type, entity_key, insight)
       DO UPDATE SET content=EXCLUDED.content, summary=EXCLUDED.summary, model=EXCLUDED.model, sources=EXCLUDED.sources, created_at=now()`,
      [type, key, insight, content, summary, INSIGHT_MODEL, JSON.stringify(sources)]);
```
Leave the existing `catch (_)` fallback upsert as-is (it omits `summary`/`sources` for pre-migration DBs).

- [ ] **Step 4: Return `summary` and the parsed `content` to callers**

Change the success return so the client gets both:
```js
  return { content, summary, sources, cached: false, generatedAt: new Date().toISOString() };
```
Also update the cache-hit return (the `if (hit.length)` branch) to include `summary` when present:
```js
  if (hit.length) return { content: hit[0].content, summary: hit[0].summary || null, sources: hit[0].sources || [], cached: true, generatedAt: hit[0].created_at || null };
```
And widen the cache SELECT to include `summary` (with the existing try/catch fallback that selects fewer columns):
```js
    try { hit = await sql.query(`SELECT content, summary, sources, created_at FROM ai_insights WHERE entity_type=$1 AND entity_key=$2 AND insight=$3 LIMIT 1`, [type, key, insight]); }
    catch (_) { hit = await sql.query(`SELECT content FROM ai_insights WHERE entity_type=$1 AND entity_key=$2 AND insight=$3 LIMIT 1`, [type, key, insight]); }
```

- [ ] **Step 5: Sanity-check syntax**

Run: `node -c lib/insight-core.js`
Expected: no output (valid).

- [ ] **Step 6: Commit**

```bash
git add lib/insight-core.js
git commit -m "feat(trends): generate+store SUMMARY/DETAIL, return summary to clients"
```

---

## Task 4: api/trending — attach stored summaries

**Files:** Modify `api/trending.js`

- [ ] **Step 1: Import the DB helper**

Below the existing require:
```js
const { getSql } = require('../lib/db');
```

- [ ] **Step 2: Attach summaries after normalize**

Replace the `const topics = normalizeTrending(results, LIMIT);` line and the response block with a guarded summary join:
```js
    const topics = normalizeTrending(results, LIMIT);

    // Attach the stored one-liner ("why it's trending") for any trend we've
    // already briefed. One lookup keyed by lower(query); absent => no summary.
    try {
      const sql = getSql();
      if (sql && topics.length) {
        const keys = topics.map((t) => String(t.query || '').toLowerCase());
        const rows = await sql.query(
          `SELECT entity_key, summary FROM ai_insights
            WHERE entity_type='trend' AND insight='brief' AND summary IS NOT NULL
              AND entity_key = ANY($1)`, [keys]);
        const byKey = new Map(rows.map((r) => [r.entity_key, r.summary]));
        topics.forEach((t) => { t.summary = byKey.get(String(t.query || '').toLowerCase()) || null; });
      }
    } catch (_) { /* DB optional — render without summaries */ }

    res.setHeader('Cache-Control', CACHE_HEADER);
    res.setHeader('Vercel-Cache-Tag', 'trending-all');
    return res.status(200).json({ topics, fetched, geos: GEOS });
```

- [ ] **Step 3: Sanity-check syntax**

Run: `node -c api/trending.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add api/trending.js
git commit -m "feat(trends): attach stored summary one-liner to /api/trending items"
```

---

## Task 5: newsfeed — export source-chip helpers for reuse

**Files:** Modify `js/components/newsfeed.js`

- [ ] **Step 1: Export `resolveSource` and `sourceChip`**

Add `export` to the existing `function resolveSource(s)` and `function sourceChip(r)` declarations (lines ~77 and ~86) so the new module can build the sources bar from the same logic:
```js
export function resolveSource(s) { /* unchanged body */ }
export function sourceChip(r) { /* unchanged body */ }
```

- [ ] **Step 2: Sanity check (no runtime test; grep export)**

Run: `grep -n "export function resolveSource\|export function sourceChip\|export function renderBriefBody" js/components/newsfeed.js`
Expected: three lines.

- [ ] **Step 3: Commit**

```bash
git add js/components/newsfeed.js
git commit -m "refactor(news): export resolveSource/sourceChip for trend expansion reuse"
```

---

## Task 6: trend-expansion module (the expanded body)

**Files:** Create `js/components/trend-expansion.js`

- [ ] **Step 1: Create the module**

Create `js/components/trend-expansion.js`:
```js
// Renders the expanded body of a trend card: a sources bar (cited sources),
// "Web Explore" + "AI Explore" accordions (submit the term to engines/models),
// and the full grounded brief. Reuses the news/TI building blocks so the look
// matches AI insights elsewhere.
import { renderBriefBody, resolveSource, sourceChip } from './newsfeed.js';
import { renderTIAccordion, webSourceItem } from './ti-shortcuts.js';
import { getExternalSearches, getExternalSearchCategories, getModels } from '../utils/data.js';

function escapeAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeHTML(str) { const d = document.createElement('div'); d.textContent = str ?? ''; return d.innerHTML; }

// Horizontal-scroll bar of the brief's cited sources (deduped). Empty if none.
function sourcesBar(sources) {
  if (!sources || !sources.length) return '';
  const seen = new Set();
  const chips = [];
  for (const s of sources) {
    const r = resolveSource(s);
    const key = (r.label || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    chips.push(sourceChip(r));
  }
  if (!chips.length) return '';
  return `<div class="trend-exp-sources"><span class="trend-exp-sources-label">Sources</span><div class="trend-exp-sources-scroll">${chips.join('')}</div></div>`;
}

// Web Explore: external search engines grouped by category, term substituted.
function webExploreHTML(term) {
  const searches = getExternalSearches() || [];
  if (!searches.length) return '';
  const cats = getExternalSearchCategories() || [];
  const order = cats.length ? cats.slice() : [{ key: '__all', label: '' }];
  const known = new Set(order.map((c) => c.key));
  const leftovers = searches.filter((s) => !known.has(s.category));
  if (leftovers.length) order.push({ key: '__other', label: 'Other' });
  const groupsHTML = order.map((cat) => {
    const items = cat.key === '__other' ? leftovers
      : cat.key === '__all' ? searches
      : searches.filter((s) => s.category === cat.key);
    if (!items.length) return '';
    const heading = cat.label ? `<li class="ti-subhead" aria-hidden="true">${escapeHTML(cat.label)}</li>` : '';
    return `<ul class="ti-item-list ti-item-list-grouped">${heading}${items.map((s) => webSourceItem(s, term)).join('')}</ul>`;
  }).join('');
  return renderTIAccordion({ key: 'websources', label: 'Web Explore', open: false, bodyHTML: `<div class="ti-source-groups">${groupsHTML}</div>` });
}

// AI Explore: each AI model opened with the trend term as its prompt.
function aiModelItem(model, term) {
  const prompt = `Explain what "${term}" is and why it's trending right now — what just happened and brief context.`;
  const url = String(model.urlTemplate || model.chatUrl || '').replace(/\{prompt\}/g, encodeURIComponent(prompt));
  const desc = model.description ? `<span class="ti-item-desc">${escapeHTML(model.description)}</span>` : '';
  return `<li class="ti-item-row"><a class="ti-item ti-item-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" data-name="${escapeAttr(model.name)}" title="Ask ${escapeAttr(model.name)}"><span class="ti-item-name">${escapeHTML(model.name)}</span>${desc}</a></li>`;
}
function aiExploreHTML(term) {
  const models = (getModels() && getModels().models) || [];
  if (!models.length) return '';
  const list = `<ul class="ti-item-list">${models.map((m) => aiModelItem(m, term)).join('')}</ul>`;
  return renderTIAccordion({ key: 'discover', label: 'AI Explore', open: false, bodyHTML: list });
}

// Full expanded body. `brief` = { content, sources } from /api/insight.
export function renderTrendExpansionBody(term, brief) {
  const content = (brief && brief.content) || '';
  const sources = (brief && brief.sources) || [];
  return [
    sourcesBar(sources),
    `<div class="trend-exp-explore">${webExploreHTML(term)}${aiExploreHTML(term)}</div>`,
    `<div class="trend-exp-full">${renderBriefBody(content, [])}</div>`,
  ].join('');
}
```

- [ ] **Step 2: Verify `getModels`/`getExternalSearches` exports exist**

Run: `grep -n "export function getModels\|export function getExternalSearches\|export function getExternalSearchCategories" js/utils/data.js`
Expected: three lines. If `getExternalSearchCategories` is missing, use `getExternalSearches` only (single group).

- [ ] **Step 3: Commit**

```bash
git add js/components/trend-expansion.js
git commit -m "feat(trends): trend-expansion module (sources bar + Web/AI Explore + full brief)"
```

---

## Task 7: trending.js — card one-liner + wire expansion

**Files:** Modify `js/components/trending.js`

- [ ] **Step 1: Import the expansion renderer**

At the top imports (where `renderBriefBody` is imported), add:
```js
import { renderTrendExpansionBody } from './trend-expansion.js';
```

- [ ] **Step 2: Render the clamped one-liner on the card**

In `trendCardHTML`, pass the summary through and render it under the meta line. Replace the `meta` block in the returned template with:
```js
          ${meta ? `<span class="trend-card-meta">${escapeHTML(meta)}</span>` : ''}
          ${topic.summary ? `<span class="trend-card-summary">${escapeHTML(topic.summary)}</span>` : ''}
```

- [ ] **Step 3: Render the rich expansion in `showTrendBrief`**

Replace the success-branch render (the line that sets `region.innerHTML = ...renderBriefBody...`) so it uses the new body, keeping the head + "Open in chat" deeper button:
```js
    region.innerHTML = `${headHTML}${renderTrendExpansionBody(term, data)}<button type="button" class="ai-result-deeper">Open in chat ↗</button>`;
    region.querySelector('.ai-result-close')?.addEventListener('click', () => region.remove());
    region.querySelector('.ai-result-deeper')?.addEventListener('click', () => openTrendChat(card));
```
(The loading state, error fallback to `openTrendChat`, and toggle-off behavior stay as-is.)

- [ ] **Step 4: Add the open/closed visual state on the card**

In `showTrendBrief`, when creating `region`, mark the card open; on close, unmark. After `card.appendChild(region);` add:
```js
  card.classList.add('is-open');
  card.querySelector('.trend-card-trigger')?.setAttribute('aria-expanded', 'true');
```
And in the close handler(s) and the toggle-off path (`if (existing) { existing.remove(); ... }`), add before returning:
```js
    card.classList.remove('is-open');
    card.querySelector('.trend-card-trigger')?.setAttribute('aria-expanded', 'false');
```

- [ ] **Step 5: Sanity check — module imports resolve**

Run: `grep -n "renderTrendExpansionBody\|trend-card-summary\|is-open" js/components/trending.js`
Expected: import line + summary span + state toggles present.

- [ ] **Step 6: Commit**

```bash
git add js/components/trending.js
git commit -m "feat(trends): card one-liner + rich inline expansion wiring"
```

---

## Task 8: Styles + cache-bust + migration + preview deploy

**Files:** Modify `css/styles.css`, `index.html`

- [ ] **Step 1: Add expansion styles**

Append to `css/styles.css` (near the trend-card / .ai-result rules), using existing tokens:
```css
/* Trend card one-liner (collapsed front view) */
.trend-card-summary {
  display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical;
  overflow: hidden; margin-top: 2px;
  font-size: 0.72rem; line-height: 1.35; color: var(--color-text-light, #5b6b86);
}
.trend-card.is-open .trend-card-summary { -webkit-line-clamp: 2; }

/* Expanded trend body */
.trend-exp-sources { display: flex; align-items: center; gap: 8px; margin: 4px 0 10px; }
.trend-exp-sources-label { flex: 0 0 auto; font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-muted, #8b94a5); }
.trend-exp-sources-scroll { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: thin; }
.trend-exp-sources-scroll::-webkit-scrollbar { height: 5px; }
.trend-exp-sources-scroll::-webkit-scrollbar-thumb { background: var(--color-surface-border, #dfe4ec); border-radius: 999px; }
.trend-exp-sources-scroll .ai-source-chip { flex: 0 0 auto; }
.trend-exp-explore { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.trend-exp-full { border-top: 1px solid var(--color-surface-border, #e6eaf1); padding-top: 8px; }
```

- [ ] **Step 2: Bump cache-bust versions in index.html**

Per the cache-busting rule, bump BOTH `css/styles.css?v=` and `js/app.js?v=` query params in `index.html` to a new value.

Run: `grep -n "styles.css?v=\|app.js?v=" index.html`
Then increment each `?v=` number.

- [ ] **Step 3: Commit code + styles**

```bash
git add css/styles.css index.html
git commit -m "feat(trends): trend expansion styles + cache-bust"
```

- [ ] **Step 4: Run the DB migration against production Neon**

Pull env and migrate (Vercel CLI already linked/authed):
```bash
~/.npm-global/bin/vercel env pull .env.production.local --environment=production --yes
set -a && . ./.env.production.local && set +a && npm run db:migrate
rm -f .env.production.local
```
Expected: `✓ Applied N statements from db/schema.sql` (additive `ADD COLUMN IF NOT EXISTS summary` — safe/idempotent).

- [ ] **Step 5: Push the branch (preview deploy, NOT production)**

```bash
git push -u origin feat/trend-summaries-expansion
```
This produces a Vercel PREVIEW deployment for review. Do NOT merge to `main` until the user approves.

- [ ] **Step 6: Verify on the preview**

- Open the preview URL; on the homepage, confirm top trends show a one-line summary; click a trend → expands inline with sticky header, sources bar, Web Explore + AI Explore accordions (term injected into links), and the full brief; collapse restores the grid; same in the Trending nav modal.
- Admin AI-Usage tab: confirm grounded `searches` count did not jump (no new grounding introduced).
- Trigger a fresh trend brief if needed: `curl -s -X POST <preview>/api/insight -H 'content-type: application/json' -d '{"type":"trend","query":"<a current trend>","refresh":"1"}'` and confirm the response includes `summary`.

---

## Self-review notes

- **Spec coverage:** one-liner generation (T1/T3), storage (T2/T3), homepage/modal delivery (T4) + render (T7), inline expansion with header/sources/Web+AI Explore/full (T6/T7), styling (T8), bounded-coverage (no on-demand long-tail generation — T4 only reads existing summaries), migration (T8). All spec sections mapped.
- **Type consistency:** `parseTrendBrief` returns `{summary, content}` (T1) used identically in T3; `/api/insight` returns `{content, summary, sources}` consumed by `renderTrendExpansionBody(term, data)` (T6/T7); `topic.summary` set in T4, read in T7.
- **Cache caveat:** `/api/trending` is edge-cached 1h SWR — newly-briefed summaries appear on the next cache refresh (acceptable per spec).
- **Popup nuance:** AI Explore uses plain anchor links (matches Web Sources). The richer synchronous-window.open/copy flow (see reference_submit_popup_block) is out of scope for v1.

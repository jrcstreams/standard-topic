# Trend one-liners + inline trend expansion — design

**Date:** 2026-06-08
**Status:** Approved (design), pending spec review → implementation plan

## Goal

Every trending item gets a short AI "why it's trending" summary surfaced on the
front view (homepage grid + Trending nav modal). Clicking a trend expands it in
place into a richer view: a sticky header (title, topic, trending-since, the
one-line summary), a horizontal-scroll bar of cited sources, two accordion
expanders ("Web Explore" / "AI Explore"), and the full why-it's-trending brief.

The one-liner is part of the AI brief we already generate for trends — no new
Gemini call, no new grounding cost.

## Decisions (locked with user)

1. **Expansion surface:** inline card expansion (not the full-panel detail
   modal). The clicked card's header becomes the accordion parent; the body
   expands below it. Identical on homepage grid and the Trending nav modal.
2. **Summary coverage:** bounded to trends the cron has already briefed
   (ranked/top trends first). Un-briefed trends show no summary line until the
   cron fills them. Keeps us fully inside the free Google-Search grounding tier
   (see [[project-ai-insights]] cost model — SEARCH_BUDGET 1400/day).
3. **One-liner production:** a dedicated 1-sentence summary AND the full body are
   produced in a SINGLE grounded generation, then stored separately and split on
   render. Zero added cost vs today.

## Non-goals

- No change to the homepage list data source (stays live `/api/trending` /
  SerpAPI). Summaries are attached via one DB lookup, not a new pipeline.
- No grounded generation for un-briefed/long-tail trends on demand (would breach
  the grounding budget). Coverage grows via the existing cron.
- No redesign of the full-panel `trending-detail-modal` as a destination. Its
  Web-Sources logic is reused by the new inline module; redundant parts retired.

## Architecture

### 1. Generation & storage (`lib/insight-core.js`, `db/schema.sql`)

- Restructure `trendPrompt()` to instruct the model to return two labeled parts:
  ```
  SUMMARY: <one sentence, ≤ ~20 words — plainly why this is trending right now>
  DETAIL:  <3–5 sentence brief: what it is, why it's trending now (what just
            happened), brief context>
  ```
  Keep the existing grounding + anti-hallucination + today's-date instructions.
- In `generateInsight()` for `type==='trend'`, parse the model output:
  - `summary` = text after `SUMMARY:` up to `DETAIL:` (trimmed, single line).
  - `content` = text after `DETAIL:` (the full brief, as today).
  - Fallback if labels are missing: `content` = whole output, `summary` = first
    sentence of `content`.
- **Schema:** `ALTER TABLE ai_insights ADD COLUMN IF NOT EXISTS summary TEXT;`
  (nullable; only trend rows populate it). Store `summary` alongside `content` in
  the existing upsert. Other entity types leave it NULL.
- Migration runs via the established `npm run db:migrate` / Vercel CLI path.

### 2. Delivery to the list (`api/trending.js`)

- After normalizing the live SerpAPI trends, run ONE DB lookup keyed by the
  visible queries:
  ```sql
  SELECT entity_key, summary
    FROM ai_insights
   WHERE entity_type='trend' AND insight='brief'
     AND entity_key = ANY($1)        -- lower(query) for each trend
  ```
- Attach `summary` (or null) to each trend object in the response. If the DB is
  unavailable, summaries are simply absent (graceful — current behavior).

### 3. Collapsed card (`js/components/trending.js` — `trendCardHTML`)

- Add a one-line, single-line-clamped `summary` under the existing
  `category · trending Xh` meta line. Omitted entirely when `summary` is null
  (no empty row). No other card changes.

### 4. Expanded view (new `js/components/trend-expansion.js`)

A single exported renderer mounted inline by both the homepage card and the nav
modal row. Replaces the body currently produced by `showTrendBrief`.

Vertical order inside the expansion:
1. **Sticky header (accordion parent):** ↗ title, `topic · Trending since Xh
   ago`, and the one-line summary (already in the list payload — renders
   instantly, no fetch needed for the header).
2. **Sources bar:** a `Sources:` label + horizontal-scroll row of the brief's
   cited sources as `.ai-source-chip`s (reused). Hidden if the brief has no
   sources.
3. **Web Explore accordion** (`renderTIAccordion`): lists `external-searches.json`
   engines; each item submits the trend term via its `urlTemplate` (reuse
   `webSourceItem` substitution).
4. **AI Explore accordion** (`renderTIAccordion`): lists `ai-models.json` models;
   each submits the trend term to that model's chat/search URL.
5. **Full brief:** `renderBriefBody(content)` (shared with news).

Loading: on first expand, fetch the full brief via the existing
`POST /api/insight {type:'trend', query}` (returns `content` + `sources`; now
also `summary`). The header/one-liner is already present, so only the
sources-bar + full-brief region shows a brief loading state.

### 5. Styling (`css/styles.css`)

- New `.trend-exp-*` classes mirroring `.ti-overview` / `.ai-result`
  conventions: navy accent rail, `--color-primary` teal, `--color-surface-border`.
- Sources bar: horizontal scroll wrapper reusing `.ai-source-chip`.
- Web/AI Explore reuse the existing `.ti-accordion` styles via `renderTIAccordion`.
- No new color tokens. Mobile: card summary clamp + expansion padding follow the
  existing trending breakpoints (899.98px / 640px).

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| `trendPrompt` + parse (`insight-core.js`) | Produce + split summary/full | `gemini.generate` |
| `ai_insights.summary` column | Persist the one-liner | schema migration |
| `api/trending.js` summary join | Attach summary to list items | `lib/db` |
| `trendCardHTML` (`trending.js`) | Show clamped one-liner on the card | list payload |
| `trend-expansion.js` (new) | Render the full expanded body | `renderBriefBody`, `renderTIAccordion`, `webSourceItem`, `external-searches.json`, `ai-models.json` |
| `.trend-exp-*` (styles.css) | Visual treatment | existing tokens |

## Data flow

```
cron/pregenerate → generateInsight(trend) → Gemini (1 grounded call)
  → parse SUMMARY/DETAIL → upsert ai_insights{summary, content, sources}

homepage load → GET /api/trending (SerpAPI normalize)
  → join ai_insights.summary by lower(query) → list items gain `summary`
  → trendCardHTML renders clamped one-liner

click card → trend-expansion mounts inline
  → header+summary instant (from payload)
  → POST /api/insight{trend} → content+sources → sources bar + full brief
  → Web/AI Explore accordions from static data
```

## Error handling / edge cases

- Un-briefed trend: no summary line; expansion still works (fetch generates or
  returns the brief, sources bar appears once available).
- Parse failure on SUMMARY/DETAIL: fallback to first-sentence summary; never
  blank.
- DB down during `/api/trending`: summaries omitted; cards render as today.
- No sources on a brief: sources bar hidden.
- Existing cached briefs predate `summary`: backfilled on next cron refresh, or
  flushed via `?type=purge&scope=trends`.

## Testing / verification

- Unit-ish: SUMMARY/DETAIL parser handles labeled output, missing labels, and
  extra whitespace (fallback path).
- Manual (Playwright, real browser — restore viewport + unroute after): homepage
  card shows clamped one-liner; click expands inline with header/summary/sources
  bar/Web+AI Explore/full brief; Web & AI Explore links carry the trend term;
  collapse restores the grid; same behavior in the Trending nav modal; mobile
  layout intact.
- Cost check: confirm grounded search count unchanged in the admin AI-Usage tab
  after a cron run (no new searches introduced).

## Open follow-ups (out of scope)

- Admin control to force-regenerate summaries (the purge path already covers it).
- "Over time" history view enrichment with summaries.

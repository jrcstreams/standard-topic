# Trending Topics (homepage) — Design

**Date:** 2026-06-03
**Status:** Approved (pending spec review)

## Summary

Add a **Trending Topics** section to the homepage that lists currently
trending Google searches (US) pulled from SerpAPI's
`google_trends_trending_now` engine. Each trending term links to the
site's existing Custom Search page. The section appears as a sidebar card
above Topic Intelligence on desktop, and as its own "Trending" tab
(between News Feed and Topic Intelligence) on mobile.

Freshness is hourly, achieved with Vercel edge caching + on-demand
stale-while-revalidate so SerpAPI is called at most ~once/hour regardless
of traffic (~720 calls/month) and **zero** times when no one visits.

## Scope

- **Homepage only.** Not on topic pages or custom-search pages.
- **US trending only** for v1, but the server's geo list is a config
  array so adding regions later (UK, DE, …) is a one-line change.
- No search-volume badges or trend arrows — clean query rows only.
- No Vercel Cron — on-demand caching only.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Region | US only (`GEOS = ['US']`, config-ready for more) |
| Freshness | Hourly (`s-maxage=3600`) |
| Keep-warm | On-demand + stale-while-revalidate (no cron) |
| Initial list size | Show 7, expand to ~20 |
| Row content | Query text + chevron only (no volume / ▲) |
| Title / attribution | "Trending Topics" + small "via Google Trends" |
| Link target | `#/custom/{encodeURIComponent(query)}` (existing Custom Search) |

## Architecture

### 1. Server — `api/trending.js` (Vercel serverless function)

Mirrors `api/feeds/[topicId].js`.

- **Request:** for each geo in `GEOS` (default `['US']`), call
  `https://serpapi.com/search.json?engine=google_trends_trending_now&geo={geo}&api_key={SERPAPI_API_KEY}`.
  - With a single geo, one upstream call. Multiple geos → one call each,
    then merge.
- **Normalize:** map SerpAPI `trending_searches[]` →
  `{ query, categories, startedAt, region }`. Merge across geos, dedupe by
  normalized (lowercased, trimmed) query keeping the first/highest-ranked
  occurrence, cap at ~20. (Search volume / increase percentage are parsed
  but NOT surfaced in the UI per the row-content decision — we keep the
  response lean and omit them.)
- **Response shapes:**
  - `200 — { topics: [...], fetched, geos }`
  - `500 — { error: "Server misconfiguration" }` (API key missing)
  - `502 — { error: "Upstream trends unavailable" }` (SerpAPI non-2xx or
    network error; upstream body intentionally not surfaced)
- **Caching headers:**
  - `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`
  - `Vercel-Cache-Tag: trending-all`
  - Effect: ≤1 SerpAPI call/hour under load; instant stale serve while a
    background request revalidates; no calls with no traffic. SerpAPI also
    does not count cached/errored searches, giving extra headroom.
- **Secret:** `process.env.SERPAPI_API_KEY` (set in Vercel env;
  optionally in gitignored `.env` for `vercel dev`).

### 2. Client data — `js/utils/trending.js`

- `fetchTrending()` → `GET /api/trending`. Caches the in-flight promise
  for the page session (so multiple renders share one request). Returns
  `{ topics, fetched }`. Throws on non-2xx so the component can show its
  error/empty state. In-memory only (no localStorage) for v1.

### 3. Component — `js/components/trending.js`

`renderTrending(container)` renders a sidebar card matching the Topic
Intelligence visual language (same card shell, header treatment, and
row/list typography as the TI sections).

Layout:

```
┌─────────────────────────────────────┐
│ 🔥  Trending Topics      via Google… │   header: accent icon + title + tiny attribution
├─────────────────────────────────────┤
│  Taylor Swift announcement         › │   row = <a href="#/custom/Taylor%20Swift…">
│  NBA trade deadline                › │   query (prominent) + chevron only
│  … (7 rows shown when collapsed)     │
│            ▾ Show more (13)          │   expands in place; expanded area scrolls (max-height)
└─────────────────────────────────────┘
            Updated 12 min ago
```

- **Collapsed:** 7 rows. **Show more (N)** reveals the rest (~20 total)
  inside a scrollable area (max-height + overflow, matching the TI
  scroll-wrap feel). **Show less** collapses back to 7.
- **Row:** `<a href="#/custom/{encodeURIComponent(query)}">` with the
  query text and a chevron affordance. Hover state signals "opens a
  search." Region tag element exists in markup but is rendered empty/hidden
  while `geos.length === 1`.
- **States:**
  - Loading: 7 shimmer skeleton rows.
  - Error/empty: quiet inline message (e.g. "Trending is taking a break —
    check back soon"), never an exception that breaks the page. This is
    also the local-dev state when the serverless function isn't running.
- **Footer:** "via Google Trends" attribution (in header) + "Updated {relative time}".

### 4. Layout integration — `app.js` + `css/styles.css` (homepage only)

A new `#section-trending` `.layout-section` is added to the **home**
layout only (not topic/custom).

- **Desktop (≥900px, app-mode):** the left sidebar column stacks
  **Trending (row 1) → Topic Intelligence (row 2)**; News Feed stays in
  the right column spanning both rows. Implemented with explicit grid
  placement on `.topic-layout`:
  - `grid-template-columns: 320px minmax(0, 1fr)` (unchanged)
  - `#section-trending { grid-column: 1; grid-row: 1; }`
  - `#section-shortcuts { grid-column: 1; grid-row: 2; }`
  - `#section-newsfeed { grid-column: 2; grid-row: 1 / span 2; }`
  - The existing left-column vertical separator (`#section-shortcuts::after`)
    is extended/retained so the divider still runs the full column height.
- **Mobile (<900px):** add a **"Trending"** tab between News Feed and
  Topic Intelligence. Wiring touches the existing `active-tab-*` system:
  - `bodyTabsRow()` gains a Trending pill (order: News Feed, Trending,
    Topic Intelligence).
  - `TAB_PANELS` and the tab show/hide logic gain `'trending'`.
  - CSS: add `#section-trending` to the mobile hide list and
    `body.app-mode.active-tab-trending … > #section-trending { display: flex; }`.
  - Router: `parseRoute` accepts `#/trending` as a home tab (alongside
    `shortcuts`/`related`) so the tab is deep-linkable and survives refresh.
- `renderTopicLayout` (home branch) renders `#section-trending` and calls
  `renderTrending(section)` after `renderShortcutsSidebar`.

### 5. Testing

- **Unit:** the SerpAPI-response → topics normalizer is a pure function
  with a Node test + captured fixture, following
  `tools/test_prompt_assembly.mjs` (e.g. `tools/test_trending_normalize.mjs`).
- **Manual:** `vercel dev` with `SERPAPI_API_KEY` in `.env` to exercise
  the real function; under plain `python -m http.server` the endpoint
  404s and the component shows its empty state (same as the news feed
  locally today). Browser check of desktop sidebar stacking + mobile tab.

## Files

- **New:** `api/trending.js`, `js/utils/trending.js`,
  `js/components/trending.js`, `tools/test_trending_normalize.mjs`.
- **Modified:** `js/app.js` (home `#section-trending` render, `bodyTabsRow`
  Trending pill, `TAB_PANELS` + tab show/hide wiring), `js/utils/router.js`
  (`#/trending` home tab), `css/styles.css` (trending card styles + desktop
  grid placement + mobile tab visibility). (`js/components/tabs.js`'s
  `renderTabs` is a separate/legacy tab renderer and is not involved.)

## Secrets / config

- New env var `SERPAPI_API_KEY` — Vercel env (required for prod) and/or
  gitignored `.env` (for `vercel dev`). Never committed.

## Out of scope (v1)

- Multiple regions (config-ready, not enabled).
- Search-volume / trend-delta UI.
- Vercel Cron warmer.
- Trending on topic/custom pages.
- Persisting last-good payload to localStorage.

# Trending Detail Modal — Design

**Date:** 2026-06-03
**Status:** Approved

## Summary

Clicking a "Trending Now" row opens a clean modal for that term instead of
navigating to the Custom Search page. The modal shows the term, a little
context from the **same** `/api/trending` response (no extra API call), a
"View on Google Trends" link, a new admin-managed set of **Trending 101**
shortcuts (AI prompts explaining why the term is trending), and the
existing Topic-Intelligence accordions scoped to the term under the header
**Trending Intelligence**.

## Decisions

| Decision | Choice |
|---|---|
| Trending Info details | Category · "trending since" time · related searches (`trend_breakdown`) · Google Trends link. **No** search volume, **no** % increase. |
| Trending 101 count | 4 starter shortcuts, admin-editable |
| Trending Intelligence groups | Discover / Learn / Analyze / More **and Web Sources** |
| Shortcut click behavior | Single click → opens the existing Review & Submit prompt modal for that prompt with `{topic}` = the term (stacked above) |
| Trending 101 storage | Dedicated `data/shortcuts-trending101.json`, edited in the admin Shortcuts tab; never shown in normal topic sidebars |

## Architecture

### 1. Data passthrough — `js/utils/trending-normalize.js`

Add two fields per normalized topic (both derivable from the existing
SerpAPI item; no new request):
- `trendBreakdown`: `Array<string>` from the item's `trend_breakdown` (related searches), defaulting to `[]`.
- `googleTrendsUrl`: constructed `https://trends.google.com/trends/explore?q={encodeURIComponent(query)}&geo={region}` (region defaults to `US`).

`category` (first of `categories`) and `startedAt` are already kept. The
`/api/trending` response shape is otherwise unchanged; `api/trending.js`
needs no logic change beyond passing the richer items through (it already
returns whatever `normalizeTrending` produces).

### 2. Trending component — `js/components/trending.js`

Each row becomes a button (or anchor with `preventDefault`) that dispatches
a `open-trending-detail` CustomEvent carrying the full topic object
`{ query, category, startedAt, trendBreakdown, googleTrendsUrl, region }`
instead of linking to `#/custom/{query}`.

### 3. Shared TI builders — `js/components/ti-shortcuts.js` (new)

Extract the reusable accordion/row builders currently inline in `app.js`
so the sidebar and the modal share one implementation:
- `groupShortcuts(shortcuts, overrideMap)`
- `renderTIAccordion({ key, label, open, bodyHTML })`
- `tiShortcutItem(shortcut, topicName, groupKey)`
- `webSourceItem(search, topicName)`
- `buildTrendingIntelligence(term)` → returns the full accordion HTML
  (Web Sources + Discover/Learn/Analyze/More) for an arbitrary term,
  reusing evergreen shortcuts + external searches with `{topic}`/`{query}`
  substituted.

`app.js` imports these instead of its local copies (behavioral parity with
today's sidebar — same output).

### 4. Trending detail modal — `js/components/trending-detail-modal.js` (new)

`initTrendingDetailModal()` creates an overlay + panel, listens for
`open-trending-detail`. On open it renders:

1. **Header:** eyebrow "Trending Now", title = Title-Cased term, close button.
2. **Sub-line:** `category · Trending since {relative time}`.
3. **Trending Info:**
   - Related searches: `Related: a · b · c` (from `trendBreakdown`; omitted if empty).
   - `↗ View on Google Trends` (opens `googleTrendsUrl` in a new tab).
   - **Trending 101** list: the 4 shortcuts (name + description rows).
4. **Trending Intelligence:** `buildTrendingIntelligence(term)` accordions.

Clicking any shortcut row (Trending 101 or Trending Intelligence) dispatches
the existing `open-prompt-modal` event with the assembled base prompt
(`shortcut.prompt` with `{topic}`→term) so the Review & Submit modal opens
on top. The trending modal stays open beneath (lower z-index). Esc / overlay
click / ✕ closes it.

### 5. Trending 101 data — `data/shortcuts-trending101.json` (new)

```json
{
  "shortcuts": [
    { "id": "why-trending", "name": "Why It's Trending", "icon": "flame",
      "description": "The story behind the spike",
      "prompt": "Explain why {topic} is trending right now — what happened, when, and what's driving the surge in interest. Keep it to a few clear sentences." },
    { "id": "the-backstory", "name": "The Backstory", "icon": "book-open",
      "description": "How we got here",
      "prompt": "Give me the essential background on {topic} so the current moment makes sense — what led up to this and what I need to know to follow it." },
    { "id": "whos-involved", "name": "Who's Involved", "icon": "users",
      "description": "The main players",
      "prompt": "Who are the key people, organizations, or teams behind {topic} right now, and what role does each play? Keep it brief." },
    { "id": "whats-next", "name": "What's Next", "icon": "compass",
      "description": "What to watch for",
      "prompt": "What happens next with {topic}? What should I watch for in the coming days, and why does it matter?" }
  ]
}
```
Loaded by `data.js` (new `getTrending101()` + fetch in `loadAllData`), exposed for the modal and admin.

### 6. Admin — `admin.html`

Add a "Trending 101" editor in the Shortcuts tab: list of rows with
id / name / icon / prompt / description inputs, add/delete/reorder, mirroring
the evergreen shortcut editor. Wire into the existing
export-changed-files mechanism so it downloads `shortcuts-trending101.json`.

### 7. Styles — `css/styles.css`

A focused, slim modal (centered overlay; near-full-height scroll on
mobile). Section headers ("Trending 101", "Trending Intelligence") in the
existing quiet eyebrow style. Reuse `.ti-accordion` styles for the
accordions and the shortcut-row styles for the Trending 101 list.

## Data flow

```
/api/trending (cached) → normalizeTrending (+trendBreakdown,+googleTrendsUrl)
  → trending.js renders rows
  → row click → open-trending-detail(item)
  → trending-detail-modal renders Info + 101 + buildTrendingIntelligence(term)
  → shortcut click → open-prompt-modal(assembled prompt) → existing flow
```

## Testing

- Extend `tools/test_trending_normalize.mjs` to assert `trendBreakdown` and
  `googleTrendsUrl` are produced (including the empty-breakdown default and
  URL encoding).
- Manual (mocked `/api/trending`): row opens modal; related searches, Google
  Trends link, Trending 101, and Trending Intelligence accordions render;
  clicking a shortcut opens Review & Submit with the term substituted;
  desktop + mobile.

## Out of scope (v1)

- Search volume / % increase in the modal.
- A path back to the Custom Search page from the modal (Google Trends link +
  Trending Intelligence cover the intent).
- Caching/persisting the clicked item beyond the in-memory event payload.

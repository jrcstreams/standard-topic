# Per-shortcut AI briefs on home + auto-refresh + news pre-generation

**Date:** 2026-06-07
**Status:** Approved (auto-load-on-expand UI confirmed by John)

## Problem

1. The home Intelligence panel has **no AI insights for shortcuts**: the group-level
   "AI overview" button (`js/app.js`) only renders when `topicName` is truthy, and home
   sets `topicName = ''`. The pregenerate cron also skips `home` explicitly. The feature
   was only ever wired for topic pages.
2. Discover/trends briefs are generate-once — the pregenerate cron fills *missing*
   briefs but never refreshes existing ones, so "what's happening now" content goes stale.
3. News-story briefs were never pre-generated, so the first click on a story insight
   waits ~10s for a live grounded generation.

## Design

### A. Per-shortcut AI briefs (home Intelligence panel)

- **Backend** (`lib/insight-core.js`): `generateInsight` accepts
  `{ type: 'shortcut', id: '<directory-id>' }`. The server resolves the shortcut's own
  prompt from `data/shortcuts-directory.json` by id — client-supplied prompt text is
  never accepted. Cached as `entity_type='shortcut', insight='item', entity_key=<id>`.
  Always grounded; same "3-5 sentences + 3-4 bullet takeaways" format instruction as
  lens briefs; maxTokens 700. Unknown id → `{ error }`.
- **Frontend** (`js/app.js`): on home only, expanding a shortcut row auto-loads its brief
  into the panel **above** "Choose a model" (instant when pre-generated). States:
  loading → brief (+ "Open in chat ↗" that dispatches `open-prompt-modal` with the
  shortcut's prompt) → or silently collapse on failure (model picker unaffected).
  Loaded once per render; re-expanding reuses the DOM.
- **Cron**: home's 38 assigned directory shortcuts (from
  `data/shortcuts-assignments.json` → `assignments.home`) join the fill loop.

### B. Auto-refresh — cron-driven (read path stays cache-only and instant)

Chosen over TTL-on-read so users never wait and spend stays predictable. Each hourly
`/api/cron/pregenerate` run fills missing briefs first, then spends leftover budget
regenerating the **stalest** entries (`refresh` flag → existing upsert path):

| Target | Stale after | ~Calls/day |
|---|---|---|
| Home shortcut items (`insight='item'`) | 24h | ~38 |
| Topic lenses `discover`, `topic-specific` | 24h | ~68 |
| Topic lens `analyze` | 72h | ~11 |
| Topic lens `learn` | never (evergreen) | 0 |
| Trend briefs for terms **in the current US snapshot** | 24h | ≤40 |

≈160 refresh calls/day — inside `AI_GROUNDED_DAILY_LIMIT` (400) and Gemini grounding
free tier (1,500/day). Refresh order: oldest `created_at` first. Lens refresh resolves
the original topic name from `data/topics.json` (entity_key is lowercased).

### C. News-story brief pre-generation

Each cron run fills briefs for recent stories (last 48h, newest first,
`coalesce(published_at, fetched_at)`) missing a `brief`, under a per-run sub-budget
(10) so news can't starve trends/shortcuts or blow the grounded limit. Entity key is
the story URL — identical to what the frontend sends, so clicks hit the cache. Older
tail still generates on-demand. Story briefs are never refreshed (a story brief is
about that story).

## Non-changes

- No schema changes, no new crons, no new endpoints — rides `/api/cron/pregenerate`
  (hourly at :15) and the `ai_insights` table.
- Topic pages keep the group-level "AI overview · {topic}" button as-is.
- `index.html` gets `?v=` bumps for `css/styles.css` and `js/app.js`.

## Error handling

- Cron: per-item failures are swallowed and retried on a later run (still missing/stale).
- Frontend: fetch failure or `{ unavailable }` hides the brief block — never a broken panel.

## Testing

- `node --check` on changed server files; stubbed-`sql` unit check of the new
  `id` path in `generateInsight` (cache-hit + unknown-id).
- Playwright against a local static server with `/api/insight` mocked: expand a home
  Discover shortcut → brief renders above the model picker (restore routes/viewport after).

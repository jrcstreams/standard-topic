# Group AI Overviews — shortcuts become sections of one generated overview

**Date:** 2026-06-07
**Status:** Approved (John: home + topic pages together; templates in JSON now, admin UI later; custom search keeps row shortcuts)

## Problem / vision shift

The AI layer should not make users pick a shortcut first. Clicking **Discover /
Learn / Analyze / Topic Insights** loads the whole group's AI overview right
there, organized into sections — one section per shortcut in that group
("Global Headlines", "Beginner's Guide", …). Each section can be explored
further in an external AI model; the whole overview can be re-run in a model.
The per-shortcut briefs shipped earlier today (`insight='item'`) are superseded
and removed.

## Scope

- **In:** home Intelligence panel + all topic pages (99 topics), AI lens groups
  (`discover`, `learn`, `analyze`, `topic-specific`).
- **Out:** custom-search pages (unbounded query space — keep current row
  shortcuts that send users out to models/web sources), the `more` group and
  Web Sources (unchanged rows/links).

## Design

### Generation — one call per (scope, group), sectioned output

- `lib/shortcut-sections.js` (new): server-side port of the client's
  `selectShortcutsForTopic` + `groupShortcuts` (incl. per-topic
  `groupOverrides` and the regex fallback buckets) reading the same data JSONs.
  `resolveSections(scope, group)` → ordered `[{id, name, prompt}]` with
  `{topic}` placeholders resolved. Scope = `'home'` or topic slug/name.
- `lib/insight-core.js`: the `type:'shortcut'` + `topic`+`group` path now
  builds a **sectioned overview prompt** from a template: model must output
  exactly one `## <Section Name>` block per shortcut, in order, 2-4 sentences
  each (+ up to 2 `- ` bullets). Grounded per lens (learn stays ungrounded).
  `maxTokens = min(300 + 170 × sections, 3600)` (home discover = 19 sections).
  Cache keys unchanged: `entity_type='shortcut'`, `entity_key=lower(topic
  name)|'home'`, `insight=<group>`. Responses now include `generatedAt`.
  The `id`/`item` path is removed.
- `data/insight-templates.json` (new): `overviewGeneration` (server),
  `sectionDeeper` + `overviewRun` (client) template strings with placeholders
  (`{groupLabel}`, `{scopeLabel}`, `{sections}`, `{shortcutPrompt}`,
  `{sectionContent}`, `{sectionNames}`). Hand-editable now; admin UI later.

### Frontend — auto-load on group expand

- Opening an AI-lens accordion (`<details>` toggle) auto-loads the overview:
  skeleton shimmer → sections (header, body, "Explore in chat ↗" per section)
  → sources + "Updated Xh ago" + "Run full overview ↗" in the overview header.
- Section ↔ shortcut matched by name (case-insensitive); the shortcut's full
  prompt is embedded as a data attribute at render time. "Explore in chat"
  dispatches `open-prompt-modal` with the `sectionDeeper` template (shortcut
  prompt + section content as context). "Run full overview" uses `overviewRun`.
  The prompt modal already handles model pick + synchronous open (popup-safe).
- Legacy cache fallback: content without `## ` sections renders as a single
  block with only the overview-level actions.
- Shortcut **rows are removed** for AI lens groups on home/topic pages (rows
  remain on custom pages and the `more` group). The old group-level
  "AI overview · {topic}" button and the per-item brief loader are removed.

### Cron

- Fills: home (3 non-empty lens groups) + 99 topics × non-empty lens groups
  (resolver decides; empty groups are never queued). ~400 one-time backfill at
  ~25/run hourly ≈ 16h, or accelerate manually with `?n=120`.
- Refresh: unchanged cadences (discover/topic-specific 24h, analyze 72h, learn
  never) **plus a format-migration rule**: any lens brief whose content lacks
  `## ` sections is treated as stale immediately (regenerates old prose-format
  briefs, including learn, exactly once).
- `item` fills/refresh removed; orphaned `item` rows are harmless.
- `AI_GROUNDED_DAILY_LIMIT` default 400 → **800** (refresh load ~235/day +
  trends + news; grounding free tier is 1,500/day; the hourly run budget hard-
  caps daily volume anyway).

## Error handling

- Resolver empty / unknown topic → `{ error }`; cron never queues empty groups.
- Generation failure → existing `unavailable` flow; accordion shows the group
  without an overview block (no broken state), retried by cron next run.

## Testing

- Node stub tests: resolver output (home discover = 19 ordered sections, topic
  overrides honored), overview prompt assembly, cache-hit returns
  `generatedAt`, removed `id` path no longer resolves.
- Playwright (local static server, `/api/insight` mocked): home Discover expand
  → sectioned overview renders with per-section deeper buttons; custom page
  still shows rows. Restore routes/viewport after.

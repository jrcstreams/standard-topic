# Admin Panel v2 + Evergreen Shortcut Model — Design

**Date:** 2026-06-02
**Status:** Approved (pending spec review)

## Problem

Two intertwined problems:

1. **Admin friction.** `admin.html` starts empty every session and forces a manual
   Import of six JSON files, in-memory editing, then Export + hand-replacing files in
   the repo. Opened as a `file://` page the file pickers misbehave, so it reads as
   "import does nothing." Eight tabs (Topics, Shortcuts Directory, Shortcut Groups,
   Topic Assignments, Quick Content, AI Models, Prompt Generator, Data Files) split
   related work across too many places, and Prompt Generator is a raw JSON textarea.

2. **Evergreen shortcuts are faked by duplication.** "Universal" shortcuts that should
   appear on every topic are hand-copied into all 99 topic assignment arrays
   (~1,485 redundant entries). The 19 shortcuts added on 2026-06-01 use a real
   `evergreen` flag + runtime injection, but the 15 older universal ones do not, so
   the two behave differently despite being the same kind of thing.

## Goals

- Every topic + custom search shows all evergreen shortcuts by default, minus
  per-topic exclusions, with one global evergreen order.
- A single unified evergreen family of **34** shortcuts — no distinction in data,
  runtime, or UI between the pre-existing 15 and the 19 added 2026-06-01.
- Per-topic exclusions editable from **both** the evergreen section and the topic's
  own tab, synced live in-session.
- Topic-specific shortcuts (~6 per topic) created, edited, and ordered on the topic's
  tab.
- Reordering (move up/down) for evergreens (global) and topic-specific (per topic).
- Consolidate to five tabs: **Topics, Shortcuts, Web Sources, AI Models, Prompt
  Generator**.
- Remove the manual-import friction: admin auto-loads live data; a single "Export
  changed files" produces only what changed.

## Non-Goals

- No backend / live persistence. Saving still flows through export → git commit →
  deploy (decision: save model "A").
- Home stays a hand-curated feed; evergreens are NOT injected on home.
- No interleaving of evergreen and topic-specific within a section beyond
  "topic-specific first, then evergreen" (decision: ordering model "A").
- No redesign of the public site UI (only the data the site reads).

## The Unified Evergreen Family

All 34 evergreens are identical in kind. There is no "legacy" vs "new" anywhere —
same `evergreen: true` flag, same `evergreenOrder`, same `evergreenExclusions`, same
admin list and controls. The migration simply brings the 15 up to the same standard
as the existing 19.

The 34 (group in brackets), split Discover 6 / Learn 17 / Analyze 11:

- **Discover (6):** Latest News and Developments, Latest Research and Reports,
  Trends to Watch, What Just Changed, The Cutting Edge, Recent Milestones
- **Learn (17):** Beginner's Guide, Catch Me Up, Glossary of Key Terms, How We Got
  Here, Industry Deep Dive, Key Players to Know, Timeline of Key Dates, Where to
  Follow This Best, The Big Ideas, How It Actually Works, The Main Types, How the
  Pieces Fit Together, Notable Examples, How It Compares, Frequently Asked Questions,
  Cheat Sheet, Best Resources to Go Deeper
- **Analyze (11):** Different Perspectives, How This Affects Me, Myths vs. Reality,
  Risks and Red Flags, Why It Matters, The Big Picture, What Drives It, What's
  Surprising, What We Don't Know Yet, Strengths and Limitations, Overhyped vs.
  Underrated

(The roster is derived from data at migration time, not hand-maintained; the lists
above reflect the current 34.)

## Data Model

### `shortcuts-directory.json`
- Each shortcut keeps `id, name, icon, prompt, description, group`.
- Evergreen shortcuts carry `evergreen: true`. Promotion sets this on the 15.

### `shortcuts-assignments.json`
- `assignments: { topicSlug: [shortcutId] }` — now holds only **topic-specific**
  shortcuts per topic (the 34 evergreens are removed from topic + `_custom` arrays;
  `home` is left untouched).
- **New** `evergreenOrder: [shortcutId]` — the single global order for all evergreens.
- **New** `evergreenExclusions: { topicSlug: [shortcutId] }` — per-topic opt-outs.
  Absent/empty means "all evergreens shown."

### Migration script (`tools/`, one-off, idempotent)
1. Set `evergreen: true` on the 15 promoted shortcuts.
2. Remove all 34 evergreen ids from every `assignments[slug]` where
   `slug ∉ {home}` (includes `_custom`).
3. Build `evergreenOrder` from current sensible order: group order
   (discover, learn, analyze, more), then existing relative order within group.
4. Initialize `evergreenExclusions = {}`.
5. Print before/after counts for verification.

## Runtime (`js/utils/data.js`)

`getShortcutsForTopic(topicSlug)`:
1. `topicSpecific = assignments[topicSlug] || assignments['_custom'] || []`, mapped to
   directory objects (assignment order preserved).
2. If `topicSlug !== 'home'`: `evergreens = directory.filter(evergreen)` sorted by
   `evergreenOrder`, minus `evergreenExclusions[topicSlug]`.
3. Return `[...topicSpecific, ...evergreens]` (deduped by id, topic-specific wins).
4. `groupShortcuts` buckets by `group`, preserving order → within each section
   topic-specific appear first, then evergreens in global order.

New getters: `getEvergreenOrder()`, `getEvergreenExclusions()`. Home path unchanged.

## Admin Tabs

### Shared shell
- **Auto-load:** on `DOMContentLoaded`, `fetch` the six `/data/*.json` files (served
  over http). Manual Import retained as fallback for offline/file:// use.
- **Dirty tracking:** each mutation marks its file dirty.
- **Export changed files** (new) downloads only dirty files; **Export all** retained.
- **Advanced raw-JSON editor** kept as a small collapsible escape hatch (not a top-level
  tab) for bulk surgery on any file.

### Topics
- Topic table/editor as today (name, slug, parent, RSS feed id, icon, featured, live).
- Selecting a topic opens a panel with:
  - **Topic-specific shortcuts:** create/edit/delete + move up/down, bucketed by group.
  - **Evergreen on this topic:** all 34 as on/off toggles; off → adds to
    `evergreenExclusions[slug]`. Writes the same in-memory structure the Shortcuts tab
    reads, so the two views stay in sync.

### Shortcuts
- Master list of every shortcut definition, filterable, with Group column and edit.
- **Evergreen section:** the 34 grouped by Discover/Learn/Analyze/More, each with
  move up/down (writes `evergreenOrder`) and an **"Excluded on N topics"** control that
  opens a topic checklist (writes `evergreenExclusions`, synced with Topics tab).
- **Groups** managed in a small subsection (id, label, order, color).

### Web Sources
- Renamed from "Quick Content". Sources gain a `category`
  (Search & reference / Social & discussion / Audio & video / Writing & newsletters).
- Manage the category list, assign each source to one, reorder within a category.
- Mirrors `external-searches.json` (`categories` + `searches[].category`) already live
  on the site.

### AI Models
- Unchanged behavior. Surface the `description` field in the row editor (it shows in
  user Settings).

### Prompt Generator
- Replace JSON textarea with a structured editor:
  - **Fields list:** each field's `label, key, type, row, multiSelect, allowCustom,
    description` + move up/down.
  - **Options sub-list** per field: `value, label, clause` + move up/down.
  - **Template strings:** `baseTemplate`, `secondaryTopicClause`, `closingLine`.

## Implementation Phasing

1. **Data + runtime:** migration script, `evergreen` on the 15, `evergreenOrder` +
   `evergreenExclusions`, `data.js` changes. Site keeps working; verify shortcuts
   render identically (topic-specific then evergreen) on topic + custom pages, home
   unchanged.
2. **Admin shell:** auto-load, dirty tracking, export-changed, five-tab consolidation,
   raw-JSON escape hatch.
3. **Shortcuts tab:** master list, evergreen mgmt (reorder + exclusions), groups.
4. **Topics tab:** per-topic topic-specific CRUD + reorder, evergreen exclusion toggles
   with live sync to Shortcuts.
5. **Web Sources + Prompt Generator editors.**

## Acceptance Criteria

- Every topic + custom search shows all 34 evergreens (minus exclusions) after the
  topic-specific shortcuts within each section; home unchanged.
- The 34 are indistinguishable in data/runtime/UI; no legacy/new branching.
- Excluding an evergreen from the Topics tab immediately reflects in the Shortcuts
  evergreen section and vice versa (same session).
- Reordering evergreens changes their order on all topics; reordering a topic's
  shortcuts changes only that topic.
- Admin opens pre-populated with no manual import; "Export changed files" outputs only
  edited files; exported files load cleanly back into the live site.
- No console errors on admin or site.
- Migration prints the derived roster and asserts the evergreen total is 34
  (Discover 6 / Learn 17 / Analyze 11) before writing.

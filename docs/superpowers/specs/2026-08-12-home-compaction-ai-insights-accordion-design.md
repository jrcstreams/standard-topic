# Homepage compaction + Trending polish + Topic-page AI Insights accordion

**Date:** 2026-08-12
**Status:** Approved, in implementation

Four independent workstreams. Nothing here changes data files, the API, or the
prompt-generator wizard.

---

## 1 · Homepage hero compaction

### Remove

The whole `.home-featstrip` block in `renderTopicLayout()` (js/app.js) — both
"rich" mini-cards (**Explore Topics** and **Prompt Library**), their preview chip
rows, and the `/data/featured-prompts.json` fetch that filled the prompt chips.
`openPromptInLibrary()` stays (still reachable from the Prompts nav dropdown) but
loses its homepage caller.

### Replace with

A compact two-line quicklinks block rendered inside the hero zone, directly under
the search input:

```
        [ Search any topic, headline or question... ]

  Popular:  ⊕ World  ⊞ Business & Finance  ⊟ Politics  ⊙ Science  ⊡ Technology   All topics →

        Looking for pre-made prompts? Access our prompt library →
```

- **Line 1** — a `Popular:` label plus 5 pills from `getFeaturedTopics()`
  (filtered of `home`, sliced to 5), each an `<a href="#/topic/{slug}">` with the
  topic's icon. Pills are markedly lighter than the old `.fs-chip`: ~28px tall,
  0.78rem, quiet border. A trailing text-only `All topics →` button dispatches
  `open-all-topics-modal`, preserving the entry point the removed card owned.
- **Line 2** — one muted sentence, centered:
  `Looking for pre-made prompts?` + the blue link `Access our prompt library →`,
  which calls `openPromptsNavDropdown()`.
- Both lines are centered and wrap gracefully; on narrow widths the pills wrap to
  two rows and the `Popular:` label stays inline.

### Tightening

With the two cards gone, close the vertical gaps between nav → search → content:
`.home-cards` row-gap, `.home-grid` gap, `.home-sections` top padding, and the
hero's own bottom padding all come down.

---

## 2 · Trending column background (desktop 2-col only)

At `min-width: 1024px`, `body.home-search .home-side` becomes a soft panel:
`background #f6f8fb`, `1px solid #e8edf5`, `border-radius 16px`, ~18px padding.
The News column keeps the white full-bleed band, so the rail reads as distinct
without shouting. Below 1024px (stacked flow) the panel is not applied — the
column stays transparent exactly as today.

Divider/hover colors inside `#home-trending` are nudged so hairlines stay visible
against the tint.

## 3 · "View more trending" becomes a link

`body.home-search #home-trending .trend-viewmore` drops the filled-pill treatment
(background, border, pill padding) and becomes a blue text link: `#2563eb`, 600
weight, trailing arrow, underline on hover. `.trend-viewmore-row` left-aligns with
the row content instead of centering, and its vertical padding shrinks.

The base `.trend-viewmore` (used by the Trending modal) is untouched.

---

## 4 · Topic page: four tabs → three

### Tab bar

`News Feed · AI Insights · Web Resources`

- The **Prompts** tab is deleted.
- **Explore Further** is renamed **Web Resources** (short form `Resources` in the
  tight-fit fallback). Its URL segment stays `/explore` so existing links keep
  working; only the visible label and `<title>` change.
- `TOPIC_TAB_LABEL` updates: `{ 'ai-insights': 'AI Insights', explore: 'Web
  Resources' }` (the `prompts` entry is dropped).

### AI Insights tab = one accordion list

The sub-tab strip (`.topic-ai-subnav`, `TOPIC_AI_GROUPS`) and its sticky-header
IntersectionObserver (`window.__aiHeadIO`) are removed. In their place, six
icon'd accordion rows in this order:

| # | Row | Body |
|---|-----|------|
| 1 | Topic-Specific Prompts | `renderAIIntelligence` group `external`, `promptsOnly: 'specific'` |
| 2 | Evergreen Prompts | `renderAIIntelligence` group `external`, `promptsOnly: 'evergreen'` |
| 3 | AI Catch Up | `renderAIIntelligence` group `discover` |
| 4 | AI Deep Dive | `renderAIIntelligence` group `topic-specific` |
| 5 | AI 101 Overview | `renderAIIntelligence` group `learn` |
| 6 | Explore Topic with External AI Models | `exploreAIModelsHTML()` + `wireExploreFurther` |

Each row has a leading icon, a title, and a one-line subtext.

**Behavior**

- All six closed on load.
- One open at a time — opening a row closes the currently open one.
- A row's body **mounts lazily on first open and then stays mounted**, hidden via
  a class. Re-opening AI Catch Up is therefore instant and never re-fires
  `/api/insight`. (Up to four live `renderAIIntelligence` instances per topic
  page; only one visible.)
- Rows 1, 2 and 6 contain nested accordions (individual prompts / model picker) —
  unchanged behavior inside.

**Deep links & state**

- `#/topic/{slug}/prompts` redirects to `#/topic/{slug}/ai-insights` with row 1
  open.
- `aii-inline-open` events and `pendingInlineAii` map a group id to a row id:
  `discover→catchup`, `topic-specific→deepdive`, `learn→overview`,
  `external→topic-prompts`, `websearch→` (Web Resources tab).
- The mobile/desktop breakpoint re-render (js/app.js ~line 195) seeds
  `pendingInlineAii` from the open accordion instead of the removed sub-tab.

### Web Resources tab

`exploreFurtherHTML()` gains an `omitAI` option; the Web Resources tab passes it
so **Explore with External AI Models** no longer appears there (it now lives in AI
Insights row 6). Section header text changes from "Explore Further" to "Web
Resources".

### Enabling changes to shared modules

- **`js/components/ai-intelligence.js`** — new scope option
  `promptsOnly: 'specific' | 'evergreen'`. In `promptLibraryHTML()` it filters to
  that list and returns the bare accordion list (no section header — the outer
  accordion title carries it).
- **`js/utils/explore-further.js`** — export `exploreAIModelsHTML(opts)`
  returning the AI-models panel body without its `<details>` wrapper; add
  `omitAI` to `exploreFurtherHTML(opts)`.

---

## Build / deploy notes

- `npm run bundle` (esbuild → `dist/`) must run before shipping; `dist/` is
  committed.
- Bump `?v=` for `css/styles.css` and `js/app.js` in `index.html`, and the `?v=`
  on each changed module import inside `app.js`.
- Every `:hover` rule added must be wrapped in `@media (hover: hover)`.

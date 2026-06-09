# Living "AI Intelligence" Component — Design Spec

**Date:** 2026-06-08
**Status:** Draft for review

## Goal

Turn the topic (and homepage) "AI Intelligence" section from a static set of lens
rows that open a takeover modal into a **living, in-place, flip-navigated
component** — a branded responsive block where a user drills lens → section
menu → section content and back, with content that's noticeably fresher than
today's 72h–168h. Name stays **AI Intelligence**.

## Engine change — ONE consolidated query per topic

Today each **lens** (Discover/Learn/Analyze/Topic-Specific) is its own grounded
query returning that lens's sections as `## Section Name` blocks (the screenshot
of "Learn" is one such query → ~10 sections). That's 4 queries × ~100 topics.

**New model:** collapse to **one grounded query per topic** that returns a
**curated set of ~12–18 sections, each tagged with a "path"** (the navigation
category — Discover / Learn / Analyze, or renamed). The UI organizes the tagged
sections into paths → section menu → content. This is "one large lens organized
into different paths/sections."

Why: (1) ~4× cheaper to refresh (1 query/topic, not 4), enabling the hourly
target; (2) matches the desired UX. The catch: one grounded call can't deeply
research ~40 sections at quality, so we **curate** the current ~40 shortcuts down
to ~12–18 strong sections (admin content task) and tag each with its path.

- Output format stays `## Section` blocks, with a path tag per section (e.g. a
  `#path:learn` marker or a leading `### <Path>` grouping the model emits).
- Stored as one row in `ai_insights` per topic (e.g. `insight='brief'`), content
  split into sections, sections grouped by path in the UI.
- `maxTokens` raised to fit ~18 sections (~3.5–4k).
- The shortcut → section definitions move from "per lens" to "one curated set
  per scope, each carrying a path tag" in the admin.

## Part 1 — The living component

New file `js/components/ai-intelligence.js`, exporting
`renderAIIntelligence(container, { scope })` where `scope` = topic slug or
`'home'`. A small state machine inside one responsive block (`.aii`).

### States

1. **Lens grid** (`view='lenses'`) — branded "AI Intelligence" header + a
   responsive grid of lens tiles (icon, name, one-line subtitle). Subtitles are
   the existing group descriptions (e.g. Discover — "What's happening right
   now.").
2. **Section menu** (`view='sections'`) — the tile **flips** to a header
   `Discover · <Topic>` with a Back control and an `Updated <t> ago` stamp, over
   a **jump-menu** list of that lens's section names (a short lens intro line may
   sit on top). This is the natural home for the "last updated" stamp that was
   pulled off the modal earlier.
3. **Section content** (`view='content'`) — flips to the chosen section: its AI
   brief body + the "Explore further with AI" control + Back.

Back walks the stack content → sections → lenses. Transitions are CSS
flip/slide (~0.3s transform+opacity). The block sizes to its container
(responsive); on mobile it's full-width and the content area scrolls.

### Data flow (one fetch, then everything is instant)

- On open, fetch the topic's single consolidated brief once via `/api/insight`
  and cache it on the component.
- Parse it into sections, each with its path tag. The lens grid = the set of
  paths present. A path's section MENU = its sections. A section's CONTENT = that
  section's body — all from the SAME payload.
- So after the one fetch, **every path/section hop is instant, no extra queries.**
- If the brief isn't generated yet, show a loading state while it generates
  on-open, then populate.

### Cost model (why hourly stays affordable)

- Regenerations/day ≈ **distinct topics opened per hour, summed over the day**
  (NOT topics × 24). A topic viewed 1,000×/hr regenerates once; an unviewed
  topic regenerates zero times. One query per topic (not 4).
- Free Google-Search tier covers ~a few hundred generations/day. ~10–15 distinct
  topics/hour → free. Scales with real traffic; widen the window (1h→2–3h) if it
  ever crosses into paid.

### Relationship to existing pieces

- For the **overview/AI-Intelligence** surface, this component replaces the need
  to open the unified insight modal — navigation happens in place.
- The unified insight modal stays as-is for **news** and **trend** insights.
- "Explore further with AI" reuses the existing prompt/model submission flow.

### Placement & layout

- **Topic pages** — the top section becomes a **~30 / 70 split**: Web Sources
  shrinks to a thin **left sidebar (~30%)**, and the living **AI Intelligence
  component takes the remaining ~70%** (its own near-full-width canvas, which
  resolves the earlier "half-width is too cramped" concern). News Feed stays
  full-width below.
- **Homepage** — a `'home'` scope version ("today's world"), bringing AI
  Intelligence back to home in this living form.
- **Search results** — the custom-term version (as today).

## Part 2 — Freshness (the "more than every 24h" ask)

Mechanism: **refresh-on-view**, mirroring the trending self-heal, instead of
blindly pre-generating every lens hourly (which would exceed the free grounding
tier).

- On a read of a lens overview, if the cached row is **older than 1 hour**,
  schedule a background regeneration (`waitUntil`) and return the cached copy
  immediately. The next view shows the fresh one.
- Window: **1 hour for ALL lenses** (Discover, Learn, Analyze, Topic-Specific).
  So everything a user actually views is ≤1h old.
- The **homepage `'home'` scope** is pre-warmed hourly by a cron (it's always on
  screen, so generate it before it's viewed). Topic/search scopes rely on
  refresh-on-view.

### Push vs pull (the important nuance)

We do NOT cron-regenerate all 4 lenses × ~35 scopes every hour — that's ~3,400
grounded gens/day, far over the free search tier (~$12k/mo). Refresh-on-view
means we only regenerate a lens when someone opens a stale one, so:
- every viewed lens is ≤1h old (the "hourly" guarantee that matters), and
- cost scales with actual views → stays free at current traffic.
Unviewed pages going stale costs nothing and nobody sees them.

### Why this is affordable

Grounding (Google Search) is the only cost; free tier ~1,500 searches/day.
Pre-generating Discover hourly for ~35 scopes ≈ 3,360 searches/day (over the
tier). Refresh-on-view scales with actual views, so anything looked at feels
~hourly-fresh while total cost stays inside the free tier at current traffic.
Optionally condense lens prompts (fewer/tighter sections) to make each
generation faster and cheaper.

### Server changes

- Add a staleness check on the cached-read path in `lib/insight-core.js`
  (`generateInsight`): when a cached brief exists but is older than its
  per-insight window, fire a background refresh and still return the cached
  content. Per-insight windows defined centrally.
- Keep the `pregenerate` cron as a backstop/pre-warm (cadence + which scopes to
  pre-warm is a tunable, not a hard hourly sweep of everything).

## Out of scope / unchanged

- The prompt + section definitions and the admin shortcut manager.
- News and trend insight modals.
- The trending list, news feed, and their freshness.

## Resolved decisions

- **Topic-page layout:** ~30/70 split — Web Sources thin left sidebar, AI
  Intelligence ~70%. (The component now has near-full-width room, so section
  content gets a comfortable canvas; very long sections scroll within the block.)
- **Freshness:** 1-hour target for all lenses, delivered via refresh-on-view;
  home pre-warmed hourly by cron.

## Open questions / risks

1. **Flip vs slide** on mobile — confirm the transition reads well at full-width.
2. **Pre-warm set beyond home** — keep just `home` hot, or `home` + top ~8
   topics? (Lean: home only to start; add topics if needed.)
3. **Condense prompts?** — optional; reduces on-view regeneration latency but
   changes section counts. Default: leave sections as-is, revisit if the
   background refresh feels slow.

## Rough build sequence

1. `ai-intelligence.js` component (3-state machine, flip transitions, back stack)
   rendering from a cached lens payload.
2. Wire it into topic pages (replace current card), homepage (`'home'`), search.
3. Server: per-insight staleness windows + on-read background refresh in
   `insight-core.js`.
4. Adjust `pregenerate` to pre-warm rather than full-sweep; set Discover window.
5. CSS: responsive block, flip/slide states, jump-menu, content view.
6. Verify live: freshness behavior, instant section nav, back stack, mobile.

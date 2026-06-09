# Session Status — 2026-06-09 (night)

Production is at **css `revamp31` / app `revamp33`** on standardtopic.com. All work below is **live**.

## Headline: the Living "AI Intelligence" component shipped

A branded, in-place, flip-navigated component: **paths grid → section menu → section content**, with a back stack and slide transitions. Replaces the old lens-row card on topic pages and brings AI Intelligence back to the homepage.

**Where it runs**
- Topic pages — in the wide 70% canvas (Web Sources is now a 30% sidebar).
- Homepage — `'home'` scope = "today's world"; shows **Now / Analyze / Learn** (For This Topic hidden — home has no topic-specific content).
- Mobile — single-column tiles in the "AI Intel" tab.
- Search results — intentionally NOT using it (kept the old shortcut-links UI; see Decisions).

**Paths = existing shortcut groups** (1:1): discover→**Now**, topic-specific→**For This Topic**, analyze→**Analyze**, learn→**Learn**.

**Freshness — refresh-on-view + tiers (live, ~free)**
- On a cached `/api/insight` read, if older than its window, it regenerates in the background (`waitUntil`) and serves the current copy; next view is fresh.
- Window = path class × topic tier: **live** = tier window (tier1 1h / tier2 6h / tier3 18h), **slow** (Analyze) 7d, **evergreen** (Learn) 30d.
- Tiers in `data/topics.json`: top-level=1 (14 topics), subtopics=3 (85). No tier-2 assigned yet.

### Files (AI Intelligence feature)
- **New:** `data/ai-paths.json` (path meta + windows), `lib/ai-freshness.js` (`effectiveWindowHours`), `js/components/ai-intelligence.js` (the component).
- **Changed:** `api/insight.js` (refresh-on-view), `data/topics.json` (`tier`), `lib/insight-core.js` (maxTokens 170→280/section, cap 3600→6000), `js/components/newsfeed.js` (`renderBriefBody` markdown), `js/app.js` (wiring + home section), `css/styles.css`, `vercel.json` (`api/insight.js` maxDuration 60).
- **Docs:** spec `docs/superpowers/specs/2026-06-08-living-ai-intelligence-design.md`, plan `docs/superpowers/plans/2026-06-09-living-ai-intelligence.md`.

## Also shipped earlier this session (all live)
- News / Trend / AI-Intelligence **insight modals** fully redesigned (brand header, Article/Trend Overview, prominent AI Brief, sub-layered Web Sources, grey accordion buttons, card-style prompt submission, bigger sublabels).
- **Scroll-into-view** on accordion expand; **scroll-hint fades** (page + modals).
- **Trending**: mirrors Google "Past 24h" (reverted a bad 4h window), self-heal one-liners, dropped Now/Over-time toggle, category filter in the modal, dirty-`SUMMARY:/DETAIL:` summary sanitizers.
- **Homepage**: AI Intelligence re-added (living form), 2-col trending (6 desktop / 3 mobile), "View more trending".
- **Search modal**: lighter tagline, copy-link icon in the bar, desktop news cards, section spacing.
- **Layouts**: 30/70 topic split; column alignment fixes.

## Decisions locked
1. **No search-results version** of the living component (custom search has no pre-generated insights; auto-generating per arbitrary term = unbounded cost). Search keeps shortcut-link UI.
2. **No code cleanup** of the old lens-row/`renderShortcutsSidebar`/`renderOverview` path — it still powers the search panel. Not dead. Leave it.

## LEFT FOR NEXT CYCLE

### 1. Content thinness / "cutoff" sections (the #57 issue) — biggest follow-up
- The maxTokens bump (revamp30) only affects **newly generated** briefs. **Existing cached briefs are still thin** until they refresh: Now/Analyze refresh on view within hours; **Learn is evergreen → carries the old thin copy ~30 days**.
- Options: (a) wait for natural refresh, (b) force a one-time regen (`/api/cron/pregenerate?type=purge&scope=all` then let it rebuild, or `?force=1` refresh), (c) **curate** Learn/Analyze down to fewer, stronger sections — Learn has ~16 sections in one query, so each is inherently thin. The curation call was deferred; this is the real fix for depth.

### 2. Tier-2 topics
- Nothing is tier 2 (6h) yet. Hand-pick busy subtopics → `tier: 2` in `data/topics.json` (or add an admin field).

### 3. Home pre-warm
- Home relies on the 3h `pregenerate` cron + refresh-on-view. If home should feel hourly without a visitor triggering it, add a dedicated hourly home pre-warm (cron or bump cadence).

### 4. Explore-further parity
- The component's "Explore further with AI" is a simplified model-picker (opens model directly). The modals have the fuller Choose-Model → Direct/Review flow. Optional: extract a shared `mountExplore()` helper (was Task 8 in the plan) and use it in both.

## WATCH / DEBUG NEXT TIME
- **Cost/volume:** confirm refresh-on-view generation volume + spend in the admin **AI Usage** tab as traffic flows. maxTokens=6000 means more output tokens/gen (cheap on flash-lite, but watch).
- **Markdown regression:** `renderBriefBody` changed (renders `*italic*`, strips stray `*`) — affects ALL AI briefs incl. news/trend modals. Spot-check those still read correctly.
- **Section descriptions:** come from matching a generated `## Section` name to a shortcut name. If the model renames a heading, the description silently drops (graceful, but watch for gaps).
- **Refresh actually firing:** hard to observe externally; verify a Tier-1 "Now" stamp advances after its window on a real visit.
- **0 console errors** as of last check on topic + home.

## Cache-bust version map (current prod)
- `index.html`: styles.css `revamp31`, app.js `revamp33`.
- app.js imports: ai-intelligence `revamp33`, insight-modal `revamp30`, newsfeed `revamp30`, trending `revamp26`, trending-list-modal `revamp26`, trending-detail `revamp9`.
- Server (no cache-bust): `api/insight.js`, `lib/insight-core.js`, `lib/ai-freshness.js`, `api/trending.js`, crons.
- **Reminder:** any JS module change → bump its `?v=` in app.js's import AND app.js + styles.css in index.html. `data.js` stays no-version (shared singleton) — don't add a `?v=` to it.

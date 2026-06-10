# AI Brief / Grounding — Working Plan

Starter for the cowork session. Translates `AI_BRIEF_GROUNDING_FIXES.md` (written
against the Anthropic API) into **this project's reality**, records what's already
shipped, and lays out the bigger moves with effort / cost / risk so we can decide
together.

> **Key reframe:** the source doc assumes Claude + the Anthropic `web_search`
> tool. Standard Topic runs on **Gemini 2.5 Flash-Lite** (`lib/gemini.js`) with
> **Google Search grounding** (`tools: [{ google_search: {} }]`). Gemini grounding
> *is* the equivalent of the doc's `web_search` recommendation — so a chunk of
> Fix 1 and Fix 2 was already in place. The gaps were narrower than the doc implies.

---

## Where the generation actually happens

- **`lib/insight-core.js`** — the one code path. `generateInsight()` handles all
  three types: `news`, `trend`, `shortcut` (group overview). Builds the prompt,
  calls Gemini (grounded when budget allows), caches the result in `ai_insights`.
- **`lib/gemini.js`** — REST client. `grounded:true` attaches Google Search and
  returns citations (`groundingChunks`) + the billable `webSearchQueries` count.
- **`data/insight-templates.json`** — the overview prompt template.
- **`lib/shortcut-sections.js`** — resolves which shortcuts make up a group on a
  page (the "## section" briefs inside a group overview).
- **Caching:** every brief is cached by `(entity_type, entity_key, insight)`. The
  prompt is NOT part of the cache key, so prompt changes only affect **new
  generations and refreshes** — existing cached briefs keep their old text until
  their refresh cycle (the pregenerate cron) regenerates them.

---

## Doc proposal → status in this project

| Doc fix | Status here | Notes |
|---|---|---|
| **Fix 1 — inject current datetime** | ✅ was date-only → **now date + time + ET** | `todayLabel()` was already injected into every prompt, but UTC date-only. Now `"Wednesday, June 10, 2026 at 9:08 AM EDT"` so the model can reason about same-day recency (the Knicks "2-0" failure mode). |
| **Fix 2 — feed real data, not "summarize the world"** | 🟡 partial | Grounding (Google Search) is ON for all lens groups. Trends already get related-search breakdown + archive headlines. **News** gets the story. **Overviews do NOT get our RSS headlines** — they lean on Google Search alone. This is the main remaining Fix-2 gap (see Next: A). |
| **Fix 3 — specificity-or-omit / no-hedge** | ✅ **shipped** | New `SPECIFICITY_RULES` block added to news + trend prompts and the overview template: every sentence must name something concrete or be omitted; no "tensions remain high" / "a natural disaster" filler; past events in past tense. This is the doc's highest-leverage fix. |
| **web_search tool for trends** | ✅ already (Gemini grounding) | No Anthropic tool needed. |
| **Global Headlines UX rethink** | ⬜ open product decision | See Next: B. |

---

## Shipped in this pass (prompt-only, zero added cost, low risk)

1. **`todayLabel()`** → date **+ time + timezone (ET)**.
2. **`SPECIFICITY_RULES`** (specificity-or-omit, no-hedge, correct tense) wired into
   `newsPrompt`, `trendPrompt`, and the `overviewGeneration` template.
3. Trend prompt now explicitly warns that **scores/outcomes/standings may have
   changed** since the model's memory — report the live state.

**These take effect on the next generation/refresh, not retroactively.** Existing
cached briefs will still read the old way until regenerated (see Next: D).

---

## Next moves (need your call)

### A. Feed our own RSS headlines into the overview prompt  *(medium effort, low risk)*
Today the discover/"Global Headlines" overview is grounded only by Google Search.
We already store fresh articles in `news_stories`. Proposal: at generation time,
pull the top ~6–10 recent stories for the topic (global for `home`) and pass them
into the overview prompt as a numbered, cited source list — exactly the pattern the
doc describes. Synthesize *from those* + grounding, cite back to them.
- **Cost:** none (same call). **Risk:** low. **Effort:** ~1 query + prompt wiring in `generateInsight`.

### B. Global Headlines: paragraph vs. 5-headlines-with-context  *(product decision)*
The doc argues a single synthesized paragraph covering unrelated world events forces
hedging. Alternative: render **5 real headlines, one sentence of AI context each**.
This is a format/UX change (new render path + maybe a new generation shape), not just
a prompt tweak. **Decide:** keep paragraph (now with specificity rules) or move to the
headline-list format for the broad "what's happening" sections?

### C. Shortcut / insight curation  *(your decisions, then I execute)*
This is the "cut stale ones, reformat" thread. Stale/over-broad sections (e.g. the
Learn path's "Catch Me Up", "The Big Ideas", plus the 17-section Learn list) live in
`data/shortcuts-directory.json` + `data/shortcuts-assignments.json`. I can trim/
reformat once you tell me **which to cut and which to reshape** — and we'll need to
purge their cached `ai_insights` rows so they regenerate. (I won't guess here; wrong
deletes are painful to undo and the cache would serve stale text.)

### D. Getting the new prompts into existing content  *(decide rollout)*
Options: (1) let the pregenerate cron refresh naturally over its cycle — zero effort,
gradual; (2) one-time targeted purge of `ai_insights` so everything regenerates on
next view — faster, but a brief cost/latency spike. Recommend (1) unless you want the
improvements visible immediately for a demo.

### E. Optional — richer synthesis model  *(cost tradeoff)*
We're on `gemini-2.5-flash-lite` ($0.10/$0.40 per 1M). Flipping `GEMINI_INSIGHT_MODEL`
to `gemini-2.5-flash` ($0.30/$2.50) buys noticeably better synthesis/specificity at
~6× output cost. Could apply it **only to the broad discover overviews** if we want
quality where it matters without a blanket cost bump.

---

## Open questions for the catch-up
1. Global Headlines: paragraph (with new rules) or 5-headlines-with-context? (B)
2. Which shortcuts/sections do we cut vs. reshape? (C)
3. Roll the new prompts out gradually (cron) or force-regenerate now? (D)
4. Worth upgrading the model for the broad overviews only? (E)

---

# Update — session 2 (decisions: do A, B, D; hold C, E)

## A — RSS headlines fed into overviews ✅ SHIPPED
`overviewHeadlines()` now pulls recent real stories from `news_stories` and feeds
them into the overview prompt as **"CURRENT HEADLINES … primary source material"**:
- **home / Global Headlines:** newest story per topic (DISTINCT ON topic_id, 36h
  window, 16 items) so the global view spans many topics instead of one feed.
- **a topic:** that topic's 10 newest stories (96h window).
- **Learn lens:** skipped (evergreen — live headlines aren't relevant).
This anchors the synthesis to concrete current stories (kills the "a natural
disaster in South America" hedge) and gives the model real titles/URLs to name.
No added cost (same call). Takes effect on next (re)generation.

## B — Global Headlines format
A delivers the **substance** of B: the section is now built from real headlines +
the specificity rule, so it should stop hedging. The *pure format swap* (render 5
headlines as a list with one AI sentence each, instead of a synthesized paragraph)
is a bigger render-path change. **Recommend:** look at the post-A output first; if
it still reads too synthesized, we do the list format as a focused follow-up. Not
building the format swap blind before seeing A's effect.

## D — rollout timing + tracking ✅ TOOLING SHIPPED
**Cron cadence:** `/api/cron/pregenerate` runs **every 3h** (8×/day), ~20–30
grounded generations per run (230s wall-clock budget, ~10s each).

**Natural ("gradual") refresh windows — how long to fully roll the new prompts in:**
| Lens | Refresh window | Gradual rollout time |
|---|---|---|
| discover, topic-specific | > 72h | **~3 days** |
| analyze | > 168h | **~7 days** |
| **learn** | **never** (evergreen) | **never — needs a force/purge** |
| trends (current snapshot) | > 24h | ~1 day |
| news briefs | not refreshed | only NEW stories get new prompt |

So gradual covers discover/topic-specific/analyze within a week, but **Learn and
existing news briefs never update on their own.**

**To force a full flush (incl. Learn)** — pick one (both need `Authorization: Bearer $CRON_SECRET`):
- `…/api/cron/pregenerate?type=refresh&force=1&n=120` — re-grounds every overview +
  current trend, stalest first, paced; run a few times until `refreshed` drops to 0.
- `…/api/cron/pregenerate?type=purge&scope=overviews` — deletes overview rows; each
  regenerates fresh on its next view or cron pass (brief first-view latency).

**Watch the rollout (new `type=status`, read-only, no cost):**
`…/api/cron/pregenerate?type=status&since=2026-06-10T13:00:00Z`
→ returns `freshByGroup` (regenerated since the cutoff), `totalByGroup`, and
`recentlyRegenerated` (last 80 keys with timestamps). Pass `since` = the prompt
deploy time to see exactly which briefs are on the new prompts.

**Recommendation:** gradual is fine for discover/topic-specific/analyze, but run one
`force=1` sweep so Learn + stale news also pick up the new prompts; use `type=status`
to confirm coverage and to review which generated.

## E — cheaper/stronger model? (research)
**The "6×" worry was based on stale pricing.** Current (2026) API pricing:
| Model | $/1M in | $/1M out | Native web grounding? |
|---|---|---|---|
| Gemini 2.5 Flash-Lite (current) | 0.10 | 0.40 | ✅ Google Search, 1,500/day free |
| Gemini 3.1 Flash-Lite | 0.10 | 0.40 | ✅ |
| Gemini 2.5 Flash | ~0.15 | ~0.60 | ✅ (~1.5× lite, **not 6×**) |
| Gemini 3 Flash | ~0.50 | ~3.00 | ✅ |
| DeepSeek V3 | ~0.27 | ~1.10 | ❌ no built-in web search |
| Kimi K2.x | (unconfirmed) | — | ❌ |

**The real lock-in isn't the token price — it's Gemini's free Google Search
grounding (1,500 queries/day).** DeepSeek / Kimi / open models are cheap per token
but have **no native web grounding**, so switching means losing live grounding +
citations and building our own retrieval (a separate, likely paid, search API) —
which would cost more and add complexity, not less.

**Recommendation:**
- Stay on Gemini for the free grounding.
- If we want richer synthesis, the cheap path is bumping the broad discover
  overviews to **Gemini 2.5 Flash (~1.5×, not 6×)** — affordable, keeps grounding.
- Only consider DeepSeek/Kimi if we fully own retrieval (feed sources, which A
  already starts) AND accept a separate search bill. Possible later, not a win now.

Sources: [DeepSeek API pricing](https://api-docs.deepseek.com/quick_start/pricing) ·
[LLM pricing comparison 2026](https://benchlm.ai/llm-pricing) ·
[DeepSeek V4/Gemini/Kimi benchmark & pricing](https://aicybr.com/blog/deepseek-pricing).

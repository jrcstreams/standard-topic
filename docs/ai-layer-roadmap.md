# AI Layer & UI Polish — What's Next

**Date:** 2026-06-07 · status of record after shipping home shortcut briefs,
cron auto-refresh, and news brief pre-generation (commit `1480d95`).

## Where the AI layer stands

One pipeline (`lib/insight-core.js` + `ai_insights` table + hourly pregenerate cron)
now covers four brief types, all pre-generated and auto-refreshed:

| Brief | Key | Refresh |
|---|---|---|
| News story | url | never (fills newest 48h) |
| Trend | query | 24h while in current snapshot |
| Topic lens (discover/learn/analyze/topic-specific) | topic name | 24h / never / 72h / 24h |
| Home per-shortcut item | directory id | 24h |

Reads are always cache-first and instant. ~160 refresh + fills/day, inside the
grounded limit and Gemini's grounding free tier.

---

## Phase 1 — Make the existing briefs feel finished (UI polish, low cost)

1. **Freshness stamp** — return `created_at` from `/api/insight` and render
   "Updated 2h ago" in the brief header. The data already exists; this is the
   single highest-trust-per-effort change since briefs now refresh on a cadence.
2. **Skeleton loading** — replace the "Generating…" text with a shimmer skeleton
   in `ai-result-body`, so the (rare) uncached path feels intentional.
3. **Sources presentation** — dedupe domains, favicon chips instead of the plain
   text list in `renderBriefBody`; cap at 4 with a "+N" overflow.
4. **Brief → chat handoff with context** — "Open in chat ↗" currently sends the
   base prompt. Prefill it with the brief's content + "expand on this" so the
   model continues rather than restarts.
5. **Mobile pass** — brief density inside `ti-shortcut-panel` on small screens
   (font sizes, padding, sources wrapping).

## Phase 2 — Spread the layer to where users already are

6. **Per-shortcut briefs on topic pages** — same `insight='item'` mechanism, but
   34 topics × ~10 shortcuts is too many to pregenerate flat. Generate
   **on-demand with caching** (first click pays once, everyone after is instant)
   and let the refresh loop only touch items that have been viewed recently
   (needs a `last_viewed_at` touch on cache hits — one column, one UPDATE).
7. **Search answer brief** — the Search modal / custom search pages get an
   inline grounded brief above results (`type:'search'`, key=query, 24h TTL,
   on-demand + cached). Turns custom search into the same "instant intelligence"
   experience as topics.
8. **Trending page integration** — trend briefs exist but check where they
   surface; add expand-for-brief on trending rows everywhere trends render
   (home, takeover modal, topic tabs).

## Phase 3 — Use the history we're storing (ties into persistent-storage next phase)

9. **History UI** — the planned frontend for news + trending archives
   (full-text search endpoints are live). An "Archive" view with date ranges.
10. **Weekly topic digest** — pregenerated "what happened this week in {topic}"
    built by feeding our own stored headlines into the prompt (self-grounding,
    cheap, very defensible content). Natural email/newsletter seed later.
11. **Trend trajectory briefs** — we keep trend snapshots every 2h; "this term
    spiked Tuesday, here's how it evolved" from `trend_breakdown` history.

## Phase 4 — Operations & insight into the insights

12. **Admin panel "AI" tab** — admin v2 has 5 tabs; add one for the AI layer:
    daily calls/spend chart from `ai_usage`, cache counts by type, stale counts,
    per-entity view + force-regenerate button (calls `/api/insight?refresh=1`).
13. **Hit/miss telemetry** — count cache hits vs live generations per entity
    type, so refresh cadences and the news sub-budget can be tuned from data
    instead of guesses.
14. **Model tiering** — env-tunable per-lens models (e.g. flash for discover,
    a stronger model for analyze briefs) once telemetry shows where quality
    matters.

---

## Suggested order

Phase 1 items 1–3 are one short session and make everything shipped this week
feel deliberate. Item 6 (topic-page item briefs) is the biggest user-visible win
after that. Phase 3 unlocks genuinely original content (digests/trajectories)
that competitors scraping live search can't replicate — that's the moat.

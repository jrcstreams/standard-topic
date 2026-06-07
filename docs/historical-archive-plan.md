# Historical Trending + News Archive — Game Plan

Goal: keep a growing, queryable history of **trending topics** and **RSS news
stories** over time, serving them **at $0, fast, and efficiently**, building on
how we serve them today.

---

## 1. Constraints / success criteria
- **$0 infrastructure** (free tiers only, no surprise bills).
- **Fast reads** (CDN-served, no cold-start on the hot path).
- **Efficient ingest** — add as close to **zero extra upstream API calls** as
  possible (SerpAPI + rss.app quotas are the real constraint, not infra).
- **Builds on the current method** (Vercel functions + static GitHub Pages).
- Doesn't bloat the app repo or trigger needless Pages rebuilds.

## 2. How it works today (baseline)
- `GET /api/trending` → SerpAPI `google_trends_trending_now` (US), normalized,
  **edge-cached 1h fresh + SWR 24h**. SerpAPI hit ≈ once/hour under load.
- `GET /api/feeds/{slug}` → rss.app v1 per topic, **15min + SWR 1h**, with
  `POST /api/webhooks/rss-app` invalidating a topic's cache on publish.
- The webhook body already includes **`data.items_new`** (the new articles).
- 100 topics, all with `rssFeedId`. Repo is public.

## 3. The core idea: **archive what we already fetch**
We never poll just to archive. We piggyback on calls we already make:
- **News (webhook topics):** the webhook hands us `items_new` → append to the
  archive. **0 extra rss.app calls.**
- **News (all topics) + Trending:** **capture-on-serve** — when a function does
  a *fresh* upstream fetch (cache miss), it also writes that payload to the
  archive. Reuses the call we already paid for → **0 extra calls.**
- A low-frequency **GitHub Actions cron** is the safety net to fill gaps for
  low-traffic topics and to guarantee at least N snapshots/day.

This keeps SerpAPI/rss.app usage essentially flat vs today.

## 4. Recommended architecture (the $0 stack)

```
                 (already happening)
 user → /api/feeds, /api/trending ──fresh fetch──► SerpAPI / rss.app
 rss.app ──webhook items_new──► /api/webhooks/rss-app
                    │ append (dedup)
                    ▼
        ┌──────────────────────────┐
        │  ARCHIVE STORE            │   ← write path
        │  monthly-sharded JSON     │
        └──────────────────────────┘
                    │ served read-only via CDN
                    ▼
     client "history" views  ◄── jsDelivr CDN (free, global)
```

**Store + serve = a dedicated public repo `standard-topic-data` served by
jsDelivr.** Why:
- $0, version-controlled, globally CDN-cached, no read compute.
- Separate repo ⇒ archive commits never trigger the app's Pages rebuild and
  never bloat the app repo's history.
- The client (and the live functions, as a fallback) just `fetch()` static JSON.

**Write path options** (pick per Phase — see §6 & §12):
- **A. GitHub Actions cron** commits the archive (single writer, no races,
  dead-simple). *Primary.*
- **B. Serverless capture** (webhook + capture-on-serve) writes via a small
  buffer, flushed to the repo by the cron. Adds near-real-time + zero extra
  API calls. *Enhancement.*

## 5. Storage layout & schemas (monthly shards + index)

```
standard-topic-data/
  index.json                                   # what exists, last-updated
  trending/2026/2026-06.json                   # all trend snapshots that month
  news/{topicSlug}/2026-06.json                # unique stories seen that month
```

**Trending shard** — append-only time series:
```json
{ "month":"2026-06", "snapshots":[
  { "ts":"2026-06-06T12:00:00Z", "geo":"US",
    "topics":[{ "query":"...", "category":"Sports", "volume":200000,
                "startedAt":"...", "rank":1 }] }
]}
```

**News shard** — unique stories, dedup by URL, keep first-seen:
```json
{ "month":"2026-06", "topic":"banking", "stories":[
  { "url":"...", "title":"...", "desc":"...", "source":"nytimes.com",
    "publishedAt":"...", "firstSeen":"2026-06-06T12:03:00Z" }
]}
```
- **Dedup by URL** → the file only grows with genuinely new stories (compact).
- Monthly sharding bounds each file (tens–hundreds KB) → fast partial fetches.

## 6. Ingestion (capture paths + cadence + quota budget)

**Path 1 — webhook (news, real-time, 0 extra calls):** extend
`/api/webhooks/rss-app` to append `items_new` to `news/{slug}/{month}.json`.

**Path 2 — capture-on-serve (news + trending, 0 extra calls):** in
`/api/feeds` and `/api/trending`, after a *fresh* upstream fetch, enqueue the
payload for archiving (only on cache-miss, so no added upstream load).

**Path 3 — GitHub Actions cron (safety net + simplest start):** a scheduled
workflow (start here) that fetches and commits. Cadence is the only quota lever:
- Trending: **1 SerpAPI call/run.** 4×/day = ~120/mo.
- News: 1 rss.app call/topic/run. 100 topics × 2×/day = ~6k/mo; to trim, archive
  **parent topics first** and/or **stagger** (⅓ of topics per run).

> **Quota is the binding constraint, not cost.** Need to confirm the SerpAPI and
> rss.app plan limits to set cadence (see §13). Paths 1–2 make this near-moot by
> reusing existing calls.

Writes never commit per-event (git bloat / races). The cron is the **single
writer**; Paths 1–2 drop records into a tiny buffer (Upstash/Vercel KV free
tier, or even a `pending/` area) that the cron flushes + dedups into shards in
**one commit per run**.

## 7. Serving + client
- Read via **jsDelivr**: `cdn.jsdelivr.net/gh/<user>/standard-topic-data@main/news/banking/2026-06.json` — global CDN, free, cached. Bust with jsDelivr's purge API on update, or pin `@<commit>` for immutable caching.
- **Client**: a "History / On this day / Archive" view that lazy-loads only the
  needed shard and **reuses the existing trend-card + news-card renderers**.
- **Bonus resilience**: live `/api/feeds` can fall back to the latest archive
  shard if rss.app is down → the feed never goes blank.

## 8. Repo bloat / retention / compaction
- Dedup + monthly shards keep files small; JSON gzips well on the CDN.
- Separate data repo ⇒ app repo + deploys stay clean.
- Retention policy (configurable): keep raw monthly shards for e.g. 12–24 mo;
  optionally roll older months into yearly summaries.
- Annual **git history squash** on the data repo if history size ever matters
  (the working tree stays small regardless).

## 9. Cost & quota check
| Component | Tier | Cost |
|---|---|---|
| GitHub Actions (public repo) | unlimited minutes | $0 |
| Data repo storage | normal repo | $0 |
| jsDelivr CDN reads | unlimited | $0 |
| KV buffer (optional) | Upstash/Vercel free | $0 |
| SerpAPI / rss.app | **existing plan** | adds ≈0 with Paths 1–2 |

## 10. Failure modes & resilience
- **Cron skipped/delayed** (free cron is best-effort) → next run catches up;
  capture-on-serve/webhook fill gaps.
- **Commit race** → single-writer cron avoids it; buffer flush is serialized.
- **Upstream down** → archive simply doesn't gain new rows that run; live feed
  can read-through to the archive.
- **Bad/oversized payload** → validate + cap items per write; skip on parse fail.

## 11. Phased rollout (each phase shippable + reversible)
1. **Data repo + schema + jsDelivr** wiring; commit a first manual snapshot.
2. **GitHub Actions cron** (trending + parent-topic news), monthly shards, index.
3. **Client history view** reusing existing cards (deep-linkable, e.g.
   `#/history` / `#/trending/2026-06-06`).
4. **Webhook capture** of `items_new` (real-time news, 0 extra calls).
5. **Capture-on-serve** in both functions + **read-through fallback**.
6. **Retention/compaction** + (optional) upgrade to SQLite if real queries
   (date-range, full-text) become needed.

## 12. Storage options compared
| Option | $0? | Read speed | Queries | New service | Notes |
|---|---|---|---|---|---|
| **GitHub repo + jsDelivr** (rec.) | ✅ | CDN-fast | fetch shard | none | native to stack; git bloat → mitigated by shards/squash |
| Cloudflare R2 | ✅ (10GB, no egress) | CDN-fast | object get | Cloudflare | no git bloat; clean object store; needs creds |
| Cloudflare D1 / Turso (SQLite) | ✅ (gen. free) | fast via API | **SQL** | DB + read API | best if you need date-range/full-text queries |
| Vercel KV / Upstash | ✅ (small free) | fast | key/scan | KV | great as a *buffer*, not long-term archive |
| Supabase/Neon (Postgres) | ✅ (pauses) | fast via API | SQL | DB | free tier sleeps; heavier |

**Recommendation:** start with **GitHub repo + jsDelivr** (Paths 3 → 1/2).
Upgrade the store to **SQLite (Turso/D1)** only if/when you need real querying.

## 13. Open decisions (need your input)
1. **SerpAPI plan + monthly search quota?** (sets trending cron cadence)
2. **rss.app plan + monthly request quota?** (sets news cron breadth/cadence)
3. **History depth** — archive all 100 topics, or parents only to start?
4. **What history UX do you want first** — "On this day", per-topic timeline,
   trending-over-time chart, or just a browsable archive?
5. OK to add a **second public repo** (`standard-topic-data`) for the archive?

# Session Handoff — 2026-06-07 (persistent storage + AI layer)

Pick-up doc for resuming. Everything below is **live on www.standardtopic.com**
unless noted. The repo is **public** — never commit secrets (keys live in Vercel
env / your own notes).

---

## TL;DR — where things stand

In one session we went from "store the data" to a semantic, AI-summarized news
platform. **All of this is shipped and working:**

- **Persistent storage** (Neon Postgres) of news + trending, fed by Vercel crons.
- **News feed** on every topic + home: live feed → **Load older stories** (archive) + filters (search / time / source / sort).
- **Homepage Trending:** **Now ⇄ Over time** toggle + **Google-category** filter.
- **Search modal:** also returns **News + Trending** results — **semantic** (meaning-based) with a relevance gate.
- **Inline AI summaries:** tap "AI Insights" on any story/trend → cached Gemini summary inline. Hard-capped at **$0.25/day** in code; on the free tier = **$0**.

**The one real bottleneck left:** embedding backfill is **throttled on Gemini's
free tier** (~285 of ~4,900 stories embedded). Keyword search works everywhere
*now*; **semantic** coverage fills in slowly until that finishes (or billing is enabled).

---

## What shipped (with the key files)

### Backend (Vercel serverless, plain CommonJS in `/api`)
| File | Role |
|---|---|
| `db/schema.sql` | Tables: `topics`, `news_stories` (tsvector full-text + `embedding vector(768)`), `trending_items` (+embedding), `ai_insights` (cached summaries), `ai_usage` (daily spend guard). pgvector + HNSW index. |
| `lib/db.js` | Neon client `getSql()` + `bulkInsert()`. Returns null if no `DATABASE_URL`. |
| `lib/gemini.js` | `generate()` (summaries), `embed()`/`embedQuery()`/`toVector()` (embeddings). Model + prices env-overridable. |
| `api/cron/trending.js` | Snapshots Google Trends → `trending_items`. Every 2h. |
| `api/cron/news.js` | rss.app → `news_stories`, dedup + prune 1000/topic. Rotates 25 topics/6h. **`?all=1`** ingests every topic; **`?batch=N`** forces a batch. |
| `api/cron/embed.js` | Backfills embeddings, newest-first, one small batch/call. **`?n=`** sets batch size (≤100). Returns `remaining` counts. |
| `api/news/[topic].js` | Stored history for a topic: `?q=` search, `?before=` paging. |
| `api/news-search.js` | **Global hybrid search** (keyword + vector, RRF-merged) with relevance **gate**. `?q= ?limit= ?before= ?debug=1`. |
| `api/trending-history.js` | `?mode=latest\|range\|query\|search`. Sortable by date/category/volume/duration. |
| `api/insight.js` | Lazy cached AI insights. `{type:news\|trend, insight, ...}`. Cache hit = instant $0; else checks daily cap then generates. |
| `api/trending.js`, `api/feeds/[topicId].js` | **Unchanged** live endpoints (homepage still served by these). |
| `scripts/db-migrate.js`, `scripts/seed-topics.js` | `npm run db:migrate` / `db:seed`. |
| `vercel.json` | Crons: trending `0 */2`, news `0 */6`, embed `30 */2`. Function timeouts. |

### Frontend (vanilla ES modules)
- `js/components/newsfeed.js` — stateful feed controller (load-older + filters) + **inline AI insights** on news cards. Exports `newsCardHTML`/`wireNewsAI`/`listHTML`.
- `js/components/trending.js` — `renderTrendingHome()` (Now/Over-time + category pills) + inline AI insights on trend cards.
- `js/app.js` — `renderSearchPanel()` (~L2310) appends **News + Trending** results in the real Search modal via `loadContentResults()`, with a **sticky "News Feed" header**. Helpers `spNewsHTML`/`spTrendHTML` near there.
- ⚠️ `js/components/search-modal.js` is the **"Topics" overlay**, NOT the Search modal users see. It has leftover (harmless) results code — ignore it.

**Current cache-bust version:** `polish54` (index.html css + app.js). Backend-only commits since then need no bump.

---

## Environment / infra (all in Vercel project env)
- **DB:** Neon `neon-violet-door` (Free) via Vercel → Storage. `DATABASE_URL`, `DATABASE_URL_UNPOOLED`.
- **Secrets:** `CRON_SECRET`, `SERPAPI_API_KEY`, `RSSAPP_API_KEY`, `RSSAPP_API_SECRET`, `GEMINI_API_KEY`.
- **Optional tunables (env, no deploy needed):** `GEMINI_MODEL` (def `gemini-2.5-flash-lite`), `GEMINI_EMBED_MODEL` (def `gemini-embedding-001`), `GEMINI_EMBED_DIM` (768), `AI_DAILY_CAP_MICROS` (250000 = $0.25), `AI_SEMANTIC_GATE` (0.47), `AI_SEMANTIC_CAP` (0.50).
- **Plan:** Vercel **Pro** (needed for 2h/6h crons).
- **Domain:** apex `standardtopic.com` 308-redirects → `www.standardtopic.com`. Test against **www**.

---

## ⏭️ What's left / next steps (priority order)

### 1. Finish embedding backfill — THE bottleneck for semantic
~4,600 stories still need vectors; free tier throttles (most `/api/cron/embed`
calls return `embedded:0`). **Decision needed:**
- **(a) Stay free / let it ride:** scheduled embed cron (every 2h) grinds it down over several days. Keyword works meanwhile.
- **(b) Enable Gemini billing (recommended if you want semantic now):** embeddings are ~pennies/month even doing all of them; lifts the rate limit so a backfill loop finishes in minutes. The $0.25/day *insight* cap is separate and still protects summaries.
- To backfill fast once unblocked: loop `GET /api/cron/embed?n=100` (auth header) until `remaining.news`/`remaining.trends` hit 0.

### 2. UI polish (you picked this — needs your eyes)
I can drive your Chrome but **can't read screenshots back**, so the loop is: you
screenshot/point at what's off, I fix precisely. Surfaces to eyeball:
- Search modal: sticky "News Feed" header on scroll, spacing, results density.
- Topic news feed: filter bar (search/time/source/sort) + "Load older stories", mobile layout.
- Homepage Trending: Now/Over-time toggle + category pills (wrapping on mobile).
- Inline AI summaries: tap "AI Insights" on a story/trend — formatting, the "Open in chat ↗" link.

### 3. (Maybe) sharper relevance — 3072-dim embeddings
768-dim distances bunch in 0.40–0.55, so the gate is a bit blunt. Full 3072-dim
would separate cleanly (simpler threshold, fewer false cuts). Cost: re-migrate
`vector(3072)` + re-embed everything. **Only do this if relevance still feels weak
after step 1 (full 768 backfill).** Don't reflex into it.

### 4. Nice-to-haves / ideas
- Trending search could be semantic too (currently keyword ILIKE).
- LLM RAG "What's happening with X" grounded in stored stories (reuses Gemini key).
- News cron frequency: sports/news topics only refresh ~daily under the 25/6h rotation — bump cadence or batch size if you want fresher sports.

---

## 🔧 Runbook (common commands)

> For curls needing auth, use `-H "Authorization: Bearer <CRON_SECRET>"` with the
> value from Vercel env. `B=https://www.standardtopic.com`.

```bash
# Embedding backfill (repeat; shows remaining counts each call)
curl -H "Authorization: Bearer $CRON_SECRET" "$B/api/cron/embed?n=100"

# Force-ingest content
curl -H "Authorization: Bearer $CRON_SECRET" "$B/api/cron/news?all=1"      # all 100 topics
curl -H "Authorization: Bearer $CRON_SECRET" "$B/api/cron/news?batch=2"    # one batch
curl -H "Authorization: Bearer $CRON_SECRET" "$B/api/cron/trending"        # trending snapshot

# Inspect search quality (debug shows keyword/vector/gate/best distance)
curl "$B/api/news-search?q=cyberattack&debug=1&limit=5"
curl "$B/api/trending-history?mode=latest"

# DB migrate / seed (from repo, with the Neon string exported)
export DATABASE_URL='postgres://…'   # same pooled Neon string as before
npm run db:migrate && npm run db:seed

# Deploy = just push; Vercel auto-builds
git push origin main
```

---

## ⚠️ Gotchas (don't relearn these)
- **Repo is PUBLIC** — never commit `CRON_SECRET`/`DATABASE_URL`/`GEMINI_API_KEY`/rss/serp keys.
- **Cache-busting:** when JS/CSS changes, bump BOTH `css/styles.css?v=` and `js/app.js?v=` in `index.html` to a new `polishNN`, AND bump the `?v=` on every changed module's import in `app.js` (a stale cached module missing a new export = blank page). Backend-only changes need no bump.
- **The real Search modal = `renderSearchPanel` in `app.js`**, not `search-modal.js`.
- **Gemini free tier throttles embeddings** — calls silently return `embedded:0` (not an error). That's the backfill slowness, nothing's broken.
- **Relevance gate is precision-biased** — borderline queries may show no news rather than weak matches. Tune via `AI_SEMANTIC_GATE`/`_CAP` env after full backfill.
- **Playwright drives your real Chrome** — fine, just expect it to navigate your active tab.

---

## ☀️ 5-minute morning start
1. Check overnight progress: `curl -H "Authorization: Bearer $CRON_SECRET" "$B/api/cron/embed?n=1"` → look at `remaining` (how many stories still unembedded).
2. Decide **embedding speed** (free-and-slow vs enable Gemini billing). If billing on → run the backfill loop in the Runbook until remaining = 0.
3. Hard-refresh the site (Cmd+Shift+R), walk the 4 polish surfaces above, jot what looks off → hand me the list.
4. Re-test semantic once more is embedded: `/api/news-search?q=home%20run&debug=1` etc.

---

## Cost posture (so there are no surprises)
- Neon Free, Vercel Pro (already paying), SerpAPI/rss.app existing plans.
- AI summaries: lazy + cached + **$0.25/day hard code-cap**; free Gemini tier = $0.
- Embeddings: ~$0.10/mo if ever billed; free tier = $0 (just slow).
- The only way costs move is if YOU enable Gemini billing — and even then it's pennies with the cap.

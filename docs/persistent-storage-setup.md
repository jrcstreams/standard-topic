# Persistent Storage — Setup & Operations

Stores a long, queryable history of **news stories** and **trending topics** in
Neon Postgres, written by Vercel Cron and served by read-only API endpoints.
Built in the project's style: plain CommonJS Vercel functions + raw
parameterized SQL (no ORM, no TypeScript, no build step).

## What got built

| File | Role |
|---|---|
| `db/schema.sql` | Tables: `topics`, `news_stories` (deduped + full-text searchable), `trending_items` (snapshot history). |
| `lib/db.js` | Neon client (`getSql`) + `bulkInsert` helper. Returns `null` when `DATABASE_URL` is unset so everything degrades gracefully. |
| `scripts/db-migrate.js` | `npm run db:migrate` — applies `db/schema.sql` (idempotent). |
| `scripts/seed-topics.js` | `npm run db:seed` — upserts all topics from `data/topics.json`. |
| `api/cron/trending.js` | WRITE path. Snapshots Google Trends (rich fields) → `trending_items`. |
| `api/cron/news.js` | WRITE path. Rotating batches of rss.app feeds → `news_stories` (dedup + prune to 1000/topic). |
| `api/news/[topic].js` | READ path. Stored news history for a topic, with `?q=` search + pagination. |
| `api/trending-history.js` | READ path. `mode=latest|range|query`, sortable by date / category / volume / duration. |
| `vercel.json` | Cron schedules (trending every 2h, news every 6h) + function timeouts. |

The existing live endpoints (`/api/trending`, `/api/feeds/[topicId]`) are
**unchanged** — the homepage keeps working exactly as today. The new endpoints
are additive. Until `DATABASE_URL` is set, the crons return `{skipped:true}`
(clean no-op, no error alerts) and the read endpoints return `503`.

## One-time setup (you do this — needs your Neon/Vercel accounts)

1. **Create the database.** Easiest path keeps it inside Vercel:
   Vercel dashboard → your project → **Storage → Create → Neon (Postgres)**.
   This auto-injects `DATABASE_URL` (and usually `DATABASE_URL_UNPOOLED`) into
   the project's env. (Or create at neon.tech and paste the connection string
   into **Settings → Environment Variables**.)

2. **Add `CRON_SECRET`** in Vercel → Settings → Environment Variables (any long
   random string). Vercel sends it automatically to the cron endpoints; our
   handlers reject anything else, so the write endpoints can't be triggered by
   randoms. *(`SERPAPI_API_KEY`, `RSSAPP_API_KEY`, `RSSAPP_API_SECRET` already
   exist — reused as-is.)*

3. **Create the tables.** From the repo with the connection string exported:
   ```bash
   npm install                      # pulls in @neondatabase/serverless
   export DATABASE_URL='postgres://...'   # from Neon/Vercel
   npm run db:migrate
   npm run db:seed
   ```
   (Or paste `db/schema.sql` into the Neon SQL editor, then run `db:seed`.)

4. **Deploy** (push to `main`). The crons start on schedule. To populate
   immediately without waiting, trigger once from the Vercel dashboard
   (Deployments → … → Crons → Run), or:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://standardtopic.com/api/cron/trending
   curl -H "Authorization: Bearer $CRON_SECRET" https://standardtopic.com/api/cron/news
   ```

## Verify

```bash
curl 'https://standardtopic.com/api/trending-history?mode=latest'
curl 'https://standardtopic.com/api/news/banking?limit=5'
curl 'https://standardtopic.com/api/news/banking?q=interest%20rates'
```

## Read API reference

**`GET /api/news/{slug}`** — stored history for a topic.
`?limit=1..100` · `?q=` full-text search · `?before=<ISO>` keyset pagination.
Returns `{ topic, count, stories, nextBefore }`.

**`GET /api/trending-history`**
- `?mode=latest&geo=US&limit=50` — newest ranked snapshot.
- `?mode=range&from=<ISO>&to=<ISO>&sort=recent|volume|duration|frequency[&category=Sports]`
  — distinct terms over a window; `duration_seconds` = how long it trended.
- `?mode=query&query=<term>` — one term's timeline across snapshots.

## Tuning knobs

- **Cadence** — `vercel.json` crons. Denser trending history → `0 * * * *` (hourly).
- **News breadth** — `BATCH_SIZE` / `FETCH_LIMIT` / `KEEP_PER_TOPIC` in `api/cron/news.js`.
  100 topics ÷ 25 per run × every 6h = full coverage daily.
- **Trending depth** — `LIMIT` in `api/cron/trending.js` (currently 100/snapshot).
- **Geo** — `GEOS` in `api/cron/trending.js` (US today; add `'GB'`, … — one SerpAPI call each).

## Next phase (not built yet)

Wire the frontend to these endpoints — a "History / On this day" view and a
trending-over-time view reusing the existing news-card / trend-card renderers.
Held until data has accumulated so the views aren't empty.

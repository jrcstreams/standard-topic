-- Storage trim — one-time migration to get back under the 0.5 GB Neon free tier.
-- Run this ONCE in the Neon SQL editor (or `npm run db:migrate` after wiring it in).
-- Pairs with the code changes in api/cron/{trending,news,embed}.js + lib/gemini.js
-- that stop WRITING the dropped columns and self-prune trending going forward.
--
-- Decisions (2026-07-22): keep semantic search but at 256-dim; 30-day trend
-- retention; stay on the free tier.
--
-- Postgres does NOT shrink files on DELETE / DROP COLUMN — the VACUUM FULL at the
-- end is what actually reclaims the space Neon bills for. Each VACUUM FULL briefly
-- rewrites (and exclusively locks) its table; fine for this low-traffic app.

-- 0) OPTIONAL — see sizes before/after:
--   SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) total
--   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--   WHERE n.nspname='public' AND c.relkind='r'
--   ORDER BY pg_total_relation_size(c.oid) DESC;

-- 1) TRENDING — apply 30-day retention (append-only, was unbounded).
DELETE FROM trending_items
 WHERE snapshot_at < now() - interval '30 days';

-- 2) TRENDING — drop the two dead columns: embedding was never queried by any
--    endpoint; raw (verbatim SerpAPI item) was never read.
ALTER TABLE trending_items DROP COLUMN IF EXISTS embedding;
ALTER TABLE trending_items DROP COLUMN IF EXISTS raw;

-- 3) NEWS — drop raw (verbatim rss.app item); no read path ever used it.
ALTER TABLE news_stories DROP COLUMN IF EXISTS raw;

-- 4) NEWS — shrink embeddings 768 -> 256 dims (3x smaller). This clears existing
--    news vectors; /api/cron/embed refills them at 256 over the next days. The
--    hybrid search endpoint falls back to keyword FTS in the meantime.
DROP INDEX IF EXISTS news_embedding_idx;
ALTER TABLE news_stories DROP COLUMN IF EXISTS embedding;
ALTER TABLE news_stories ADD COLUMN embedding vector(256);
CREATE INDEX news_embedding_idx
  ON news_stories USING hnsw (embedding vector_cosine_ops);

-- 5) OPTIONAL — clear AI-insight rows orphaned by news pruning (keyed by story URL).
-- DELETE FROM ai_insights
--  WHERE entity_type = 'news'
--    AND entity_key NOT IN (SELECT url FROM news_stories);

-- 6) RECLAIM — the step that actually frees Neon-billed bytes.
VACUUM FULL trending_items;
VACUUM FULL news_stories;
VACUUM FULL ai_insights;

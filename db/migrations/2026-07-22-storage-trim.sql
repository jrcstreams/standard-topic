-- Storage trim — one-time migration to get back under the 0.5 GB Neon free tier.
-- Run in the Neon SQL Editor in THREE steps (copy each block, Run, then the next).
-- Pairs with code in api/cron/{trending,news,embed}.js + lib/gemini.js that stops
-- WRITING the dropped columns and self-prunes trending going forward.
--
-- Decisions (2026-07-22): keep semantic search but at 256-dim; 30-day trend
-- retention; stay on the free tier.
--
-- WHY three steps: dropping the HNSW index (STEP 2) frees its space immediately,
-- giving headroom before the VACUUMs. VACUUM FULL (STEP 3) is what actually
-- reclaims the rest — but it CANNOT run in the same batch as other statements, so
-- it's isolated. Run STEP 3's lines one at a time if the editor complains.


-- =========================================================================
-- STEP 1 — see current sizes (optional, for before/after comparison)
-- =========================================================================
SELECT relname AS object,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
       pg_size_pretty(pg_indexes_size(c.oid))         AS indexes
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
ORDER BY pg_total_relation_size(c.oid) DESC;


-- =========================================================================
-- STEP 2 — trim data + drop dead objects (run this whole block together)
-- =========================================================================

-- 30-day retention on the append-only trending table.
DELETE FROM trending_items WHERE snapshot_at < now() - interval '30 days';

-- Drop the big HNSW vector index FIRST — its space is freed immediately.
DROP INDEX IF EXISTS news_embedding_idx;

-- Drop dead columns (no read path ever used any of these).
ALTER TABLE trending_items DROP COLUMN IF EXISTS embedding;
ALTER TABLE trending_items DROP COLUMN IF EXISTS raw;
ALTER TABLE news_stories   DROP COLUMN IF EXISTS raw;

-- Shrink news embeddings 768 -> 256 dims. Clears existing news vectors; the embed
-- cron refills at 256 over the next days (search falls back to keyword meanwhile).
ALTER TABLE news_stories DROP COLUMN IF EXISTS embedding;
ALTER TABLE news_stories ADD COLUMN embedding vector(256);
CREATE INDEX news_embedding_idx
  ON news_stories USING hnsw (embedding vector_cosine_ops);

-- OPTIONAL — clear AI-insight rows orphaned by news pruning (keyed by story URL):
-- DELETE FROM ai_insights
--  WHERE entity_type = 'news' AND entity_key NOT IN (SELECT url FROM news_stories);


-- =========================================================================
-- STEP 3 — reclaim the freed space (run these THREE lines by themselves;
--          if one errors, run each on its own). Do trending first.
-- =========================================================================
VACUUM FULL trending_items;
VACUUM FULL news_stories;
VACUUM FULL ai_insights;

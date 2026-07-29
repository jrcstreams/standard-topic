-- Phase 6 (RSS overhaul): semantic dedup + AI junk gate.
-- dup_of  → this story is duplicate coverage of story <id> (embedding similarity);
--           canonical story keeps dup_of NULL. Flag, not delete — auditable/reversible.
-- quality → 'ok' | 'junk' (AI-graded at ingest) | NULL = ungraded (always shown).
ALTER TABLE news_stories ADD COLUMN IF NOT EXISTS dup_of  INTEGER REFERENCES news_stories(id) ON DELETE SET NULL;
ALTER TABLE news_stories ADD COLUMN IF NOT EXISTS quality TEXT;

-- Fast lookup for the live-feed filter (api/feeds joins upstream urls → flags).
CREATE INDEX IF NOT EXISTS news_flagged_url_idx
  ON news_stories (url)
  WHERE dup_of IS NOT NULL OR quality = 'junk';

-- Cosine-similarity neighbor search for dedup (embed cron). ivfflat is fine at
-- this table size; skip if pgvector < 0.5.
CREATE INDEX IF NOT EXISTS news_embedding_cos_idx
  ON news_stories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

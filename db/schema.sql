-- Standard Topic — persistent storage schema (Neon Postgres).
-- Idempotent: safe to run repeatedly (CREATE ... IF NOT EXISTS).
-- Apply with:  npm run db:migrate   (or paste into the Neon SQL editor).

-- ---------------------------------------------------------------------------
-- topics — mirror of data/topics.json (slug is the join key everywhere).
-- Seeded/refreshed by scripts/seed-topics.js.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS topics (
  id               SERIAL PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  parent           TEXT,
  rss_app_feed_id  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- news_stories — long, deduped, searchable history of RSS articles.
-- Dedup key is (topic_id, external_id); search_vector powers full-text search.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS news_stories (
  id            SERIAL PRIMARY KEY,
  topic_id      INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  external_id   TEXT NOT NULL,
  url           TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  source_name   TEXT,
  source_url    TEXT,
  image_url     TEXT,
  published_at  TIMESTAMPTZ,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw           JSONB,
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
  ) STORED
);

CREATE UNIQUE INDEX IF NOT EXISTS news_topic_external_idx
  ON news_stories (topic_id, external_id);
CREATE INDEX IF NOT EXISTS news_topic_published_idx
  ON news_stories (topic_id, published_at DESC);
CREATE INDEX IF NOT EXISTS news_search_idx
  ON news_stories USING GIN (search_vector);

-- ---------------------------------------------------------------------------
-- trending_items — append-only snapshots of Google Trends "trending now".
-- One row per (snapshot, geo, rank). Richer than what /api/trending serves
-- today: keeps category, volume, % increase, start/end (=> duration), the
-- full breakdown, and the raw payload so future features lose no data.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trending_items (
  id               SERIAL PRIMARY KEY,
  snapshot_at      TIMESTAMPTZ NOT NULL,
  geo              TEXT NOT NULL DEFAULT 'US',
  rank             INTEGER NOT NULL,
  query            TEXT NOT NULL,
  category         TEXT,
  categories       JSONB,
  search_volume    BIGINT,
  increase_percent INTEGER,
  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  active           BOOLEAN,
  trend_breakdown  JSONB,
  raw              JSONB
);

CREATE INDEX IF NOT EXISTS trending_snapshot_geo_idx
  ON trending_items (snapshot_at DESC, geo);
CREATE INDEX IF NOT EXISTS trending_query_idx
  ON trending_items (lower(query), snapshot_at DESC);
CREATE INDEX IF NOT EXISTS trending_category_idx
  ON trending_items (category, snapshot_at DESC);

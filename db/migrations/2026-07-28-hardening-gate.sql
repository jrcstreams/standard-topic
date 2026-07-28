-- B1.1 + B1.11 hardening indexes/columns. Idempotent — safe to run anytime.
-- Apply via: DATABASE_URL='postgres://...' npm run db:migrate   (runs full schema.sql)
-- or paste these two lines into the Neon SQL editor.

-- B1.1: fast exact-URL validation for the /api/insight generation gate.
CREATE INDEX IF NOT EXISTS news_url_idx ON news_stories (url);

-- B1.11: refresh stampede claim column (self-expiring 10-min lock).
ALTER TABLE ai_insights ADD COLUMN IF NOT EXISTS refreshing_until TIMESTAMPTZ;

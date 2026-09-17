-- An edition is held until every part of it exists (revamp1433).
--
-- The briefings and the podcast are written ahead of time and must appear
-- together, so the wave writes into pending_* columns and a release step
-- promotes them once that edition's episode is on disk. A reader never sees
-- half an edition: until the promote runs, every read path keeps serving the
-- previous edition, whole.
--
-- pending_edition is the edition key, "2026-09-17|morning", so the release step
-- can promote exactly one wave and nothing else.
ALTER TABLE ai_insights ADD COLUMN IF NOT EXISTS pending_content TEXT;
ALTER TABLE ai_insights ADD COLUMN IF NOT EXISTS pending_summary TEXT;
ALTER TABLE ai_insights ADD COLUMN IF NOT EXISTS pending_sources JSONB;
ALTER TABLE ai_insights ADD COLUMN IF NOT EXISTS pending_model TEXT;
ALTER TABLE ai_insights ADD COLUMN IF NOT EXISTS pending_at TIMESTAMPTZ;
ALTER TABLE ai_insights ADD COLUMN IF NOT EXISTS pending_edition TEXT;
CREATE INDEX IF NOT EXISTS ai_insights_pending_idx
  ON ai_insights (pending_edition) WHERE pending_edition IS NOT NULL;

-- The episode is written when it is made and released with its edition.
-- NULL means "already live" so every existing row keeps working.
ALTER TABLE ai_audio ADD COLUMN IF NOT EXISTS release_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS ai_audio_release_idx ON ai_audio (release_at);

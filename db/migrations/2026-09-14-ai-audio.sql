-- Episodes of the Global AI Morning / Evening Briefing (revamp1340).
-- One row per edition. The audio lives in Vercel Blob; this row carries the
-- URL, the chapters (so the site can deep-link "play from here" per item), the
-- storyboard and script the episode was built from, and the source links.
-- Idempotent — safe to paste into the Neon SQL editor or run via db:migrate.

CREATE TABLE IF NOT EXISTS ai_audio (
  id            SERIAL PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'flagship',   -- 'flagship' (home) | later: 'family'
  family_slug   TEXT NOT NULL DEFAULT 'home',
  edition_date  DATE NOT NULL,                     -- ET editorial day
  edition       TEXT NOT NULL,                     -- 'morning' | 'evening'
  title         TEXT,
  teaser        TEXT,
  url           TEXT NOT NULL,                     -- public Blob URL of the MP3
  bytes         INTEGER,
  duration_ms   INTEGER,
  chapters      JSONB,                             -- [{label, beat, start_ms}]
  storyboard    JSONB,
  script        JSONB,                             -- segments (spoken + written) + in_focus
  sources       JSONB,                             -- [{title, uri, source, chapter}]
  voice         TEXT,
  provider      TEXT,
  chars         INTEGER,
  cost_micros   INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_audio_edition_idx
  ON ai_audio (kind, family_slug, edition_date, edition);
CREATE INDEX IF NOT EXISTS ai_audio_recent_idx
  ON ai_audio (edition_date DESC, edition);

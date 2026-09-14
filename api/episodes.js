// Vercel serverless function — /api/episodes  (GET)
//
// The podcast episodes of the Global AI Morning / Evening Briefing, read from
// the ai_audio table (see db/migrations/2026-09-14-ai-audio.sql). Audio bytes
// live in Vercel Blob; this only hands out the URL plus everything the player
// and the briefing page need to line text up with audio.
//
//   GET /api/episodes                → the latest edition
//   GET /api/episodes?date=2026-09-14&edition=morning
//   GET /api/episodes?list=30        → the last N editions, newest first (no script)
//
// 200 { episode } | { episodes:[…] } | { episode:null }   404 never — an absent
// edition is a normal state for the page, not an error.
//
// Cached at the edge for 5 minutes with stale-while-revalidate: an episode is
// written once and never changes, so the only freshness that matters is "has
// a new edition landed", and five minutes is fine for that.

const { getSql } = require('../lib/db');

const PUBLIC_COLS = `id, kind, family_slug, edition_date, edition, title, teaser, url, bytes,
  duration_ms, chapters, sources, voice, created_at`;

function shape(r) {
  if (!r) return null;
  const out = { ...r };
  for (const k of ['chapters', 'sources', 'script', 'storyboard']) {
    if (typeof out[k] === 'string') { try { out[k] = JSON.parse(out[k]); } catch (_) { out[k] = null; } }
  }
  if (out.edition_date instanceof Date) out.edition_date = out.edition_date.toISOString().slice(0, 10);
  else if (typeof out.edition_date === 'string') out.edition_date = out.edition_date.slice(0, 10);
  return out;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const sql = getSql();
  if (!sql) return res.status(503).json({ error: 'database unavailable' });
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  const q = req.query || {};
  const kind = 'flagship'; const family = 'home';

  try {
    if (q.list) {
      const n = Math.min(Math.max(parseInt(q.list, 10) || 30, 1), 120);
      const rows = await sql.query(
        `SELECT ${PUBLIC_COLS} FROM ai_audio WHERE kind=$1 AND family_slug=$2
          ORDER BY edition_date DESC, CASE edition WHEN 'evening' THEN 1 ELSE 0 END DESC LIMIT $3`,
        [kind, family, n]);
      return res.status(200).json({ episodes: rows.map(shape) });
    }
    const withScript = q.full === '1' ? ', script, storyboard' : '';
    if (q.date) {
      const date = String(q.date).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      const ed = q.edition === 'evening' ? 'evening' : (q.edition === 'morning' ? 'morning' : null);
      const rows = ed
        ? await sql.query(`SELECT ${PUBLIC_COLS}${withScript} FROM ai_audio WHERE kind=$1 AND family_slug=$2 AND edition_date=$3 AND edition=$4 LIMIT 1`, [kind, family, date, ed])
        : await sql.query(`SELECT ${PUBLIC_COLS}${withScript} FROM ai_audio WHERE kind=$1 AND family_slug=$2 AND edition_date=$3 ORDER BY CASE edition WHEN 'evening' THEN 1 ELSE 0 END DESC LIMIT 1`, [kind, family, date]);
      return res.status(200).json({ episode: shape(rows[0]) });
    }
    const rows = await sql.query(
      `SELECT ${PUBLIC_COLS}${withScript} FROM ai_audio WHERE kind=$1 AND family_slug=$2
        ORDER BY edition_date DESC, CASE edition WHEN 'evening' THEN 1 ELSE 0 END DESC LIMIT 1`, [kind, family]);
    return res.status(200).json({ episode: shape(rows[0]) });
  } catch (err) {
    // The table may not exist yet on a fresh database — that is "no episodes",
    // not a server error, so the page renders without a player.
    if (/relation "ai_audio" does not exist/i.test(String(err && err.message))) {
      return res.status(200).json(q.list ? { episodes: [] } : { episode: null });
    }
    console.error('[episodes]', (err && err.message) || err);
    return res.status(500).json({ error: 'episodes unavailable' });
  }
};

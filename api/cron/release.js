// GET /api/cron/release — publish an edition, all of it, at once (revamp1433).
//
// The wave writes the briefings into pending_* an hour before the edition is
// due, and the GitHub Actions job writes the episode with a release_at. Neither
// is visible to a reader. This endpoint is the only thing that makes an edition
// live, and it will only do so when the edition is WHOLE:
//
//   · its release time has passed, and
//   · its episode exists, and
//   · at least MIN_BRIEFS of its briefings are staged.
//
// If the episode is late, nothing happens. The reader keeps seeing the previous
// edition — complete and self-consistent, a headline over the voice that reads
// it — and this runs again a few minutes later. Late is survivable; a headline
// that does not match the audio under it is not.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`.
//   200 — { ok, released|held, edition, briefs, reason? }
const { getSql } = require('../../lib/db');
const EDITION = require('../../lib/edition');

// Kept for the response, not as a gate: make-episode refuses to build below
// eight briefings for an edition, so a thin episode never reaches this point.
const MIN_BRIEFS = 12;

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (secret && auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  res.setHeader('Cache-Control', 'no-store');

  const sql = getSql();
  if (!sql) return res.status(200).json({ ok: true, skipped: 'no database' });

  const now = new Date();
  const live = EDITION.liveEdition(now);           // the edition that is due
  const { date, edition, key } = live;

  try {
    // Is it already out? Then there is nothing to do, and saying so is cheap.
    const already = await sql.query(
      `SELECT id, release_at FROM ai_audio
        WHERE kind='flagship' AND family_slug='home' AND edition_date=$1 AND edition=$2
          AND (release_at IS NULL OR release_at <= now())
        LIMIT 1`, [date, edition]);
    const pending = await sql.query(
      `SELECT count(*)::int AS n FROM ai_insights
        WHERE entity_type='shortcut' AND insight='daily:b' AND pending_edition=$1`, [key]);
    const staged = pending[0].n;

    if (already.length && staged === 0) {
      return res.status(200).json({ ok: true, released: false, edition: key, briefs: 0, reason: 'already released' });
    }

    // The episode is the gate. No episode, no edition.
    const ep = await sql.query(
      `SELECT id FROM ai_audio
        WHERE kind='flagship' AND family_slug='home' AND edition_date=$1 AND edition=$2 LIMIT 1`,
      [date, edition]);
    if (!ep.length) {
      return res.status(200).json({ ok: true, released: false, held: true, edition: key, briefs: staged, reason: 'no episode yet' });
    }
    // The episode gates the BRIEFINGS, not the other way round. Whatever is
    // staged for this edition goes live beside it; a topic whose briefing did
    // not make it keeps the one it had, which is old but not wrong. Zero staged
    // is the transition case — briefings already published under the old rules
    // — and the episode still belongs with them.

    // Whole. Promote the briefings and open the episode, in that order, so a
    // reader can never land on an episode whose briefings have not moved yet.
    const promoted = await sql.query(
      `UPDATE ai_insights
          SET content = coalesce(pending_content, content),
              summary = coalesce(pending_summary, summary),
              model   = coalesce(pending_model, model),
              sources = coalesce(pending_sources, sources),
              created_at = now(),
              pending_content = NULL, pending_summary = NULL, pending_model = NULL,
              pending_sources = NULL, pending_edition = NULL, pending_at = NULL
        WHERE entity_type='shortcut' AND insight='daily:b' AND pending_edition=$1
        RETURNING entity_key`, [key]);
    await sql.query(
      `UPDATE ai_audio SET release_at = now()
        WHERE kind='flagship' AND family_slug='home' AND edition_date=$1 AND edition=$2
          AND (release_at IS NULL OR release_at > now())`, [date, edition]);

    return res.status(200).json({
      ok: true, released: true, edition: key,
      briefs: promoted.length, episode: ep[0].id,
    });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err).slice(0, 300) });
  }
};

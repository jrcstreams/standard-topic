// GET /api/cron/release — publish an edition, all of it, at once (revamp1433).
//
// The wave writes the briefings into pending_* an hour before the edition is
// due, and the GitHub Actions job writes the episode with a release_at. Neither
// is visible to a reader. This endpoint is the only thing that makes an edition
// live, and it will only do so when the edition is WHOLE:
//
//   · its release time has passed, and
//   · its episode exists.
//
// The episode is the gate on the briefings, not the reverse: whatever is staged
// goes live beside it, and a topic whose briefing did not land keeps the one it
// had. make-episode refuses to build below eight briefings, so a thin episode
// never reaches here.
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
const topicsData = require('../../data/topics.json');

// revamp1435b: only count topics the site still carries. daily:b rows are keyed
// by topic NAME, and the cut left rows behind for topics that no longer exist —
// they are never regenerated, so they sit permanently "behind" and would raise
// an alert every hour about nothing.
const LIVE_KEYS = (topicsData.topics || [])
  .filter((t) => t && t.name)
  .map((t) => String(t.name).toLowerCase())
  .concat(['home']);

// Kept for the response, not as a gate: make-episode refuses to build below
// eight briefings for an edition, so a thin episode never reaches this point.
const MIN_BRIEFS = 12;

// Dispatch .github/workflows/episode.yml when the scheduled run has not
// happened. Needs GITHUB_DISPATCH_TOKEN — a fine-grained PAT with Actions
// read/write on the repo — in the Vercel env; without it this only reports.
// Paced through a one-row table so ten-minute ticks do not stack kicks.
const KICK_EVERY_MS = 15 * 60 * 1000;
const GH_REPO = process.env.GITHUB_REPO || 'jrcstreams/standard-topic';
async function kickEpisodeJob(sql, editionKey) {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return { skipped: 'no GITHUB_DISPATCH_TOKEN' };
  try {
    await sql.query(`CREATE TABLE IF NOT EXISTS ops_kv (key text PRIMARY KEY, value text, updated_at timestamptz NOT NULL DEFAULT now())`);
    const last = await sql.query(`SELECT value, updated_at FROM ops_kv WHERE key='episode-kick'`);
    if (last.length && last[0].value === editionKey
        && Date.now() - Date.parse(last[0].updated_at) < KICK_EVERY_MS) {
      return { skipped: 'kicked recently', at: last[0].updated_at };
    }
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/episode.yml/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'standardtopic-release-cron',
      },
      body: JSON.stringify({ ref: 'main' }),
    });
    if (r.status !== 204) return { error: `github ${r.status}`, body: (await r.text()).slice(0, 200) };
    await sql.query(
      `INSERT INTO ops_kv (key, value, updated_at) VALUES ('episode-kick', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [editionKey]);
    return { dispatched: true };
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 200) };
  }
}

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
      const behind = await sql.query(
        `SELECT count(*)::int AS n FROM ai_insights
          WHERE entity_type='shortcut' AND insight='daily:b' AND created_at < $1
            AND entity_key = ANY($2)`,
        [live.releaseAt.toISOString(), LIVE_KEYS]);
      return res.status(200).json({
        ok: true, released: false, edition: key, briefs: 0,
        stale: behind[0].n, reason: 'already released',
      });
    }

    // The episode is the gate. No episode, no edition.
    const ep = await sql.query(
      `SELECT id FROM ai_audio
        WHERE kind='flagship' AND family_slug='home' AND edition_date=$1 AND edition=$2 LIMIT 1`,
      [date, edition]);
    if (!ep.length) {
      // revamp1439: an edition that is due with no episode is not something to
      // wait out. GitHub's cron did not fire AT ALL on the morning of
      // 2026-09-18 — no run between 08:00 and 09:30 UTC — and the hold did its
      // job, but nothing was going to end it. So this cron, which already runs
      // every ten minutes, kicks the workflow itself, at most once a quarter
      // hour. The workflow's concurrency group serialises a kick that lands on
      // top of a late scheduled run, and the second run exits in seconds when
      // it finds the episode already built.
      const kick = await kickEpisodeJob(sql, key);
      return res.status(200).json({ ok: true, released: false, held: true, edition: key, briefs: staged, reason: 'no episode yet', kick });
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
              created_at = $2,
              pending_content = NULL, pending_summary = NULL, pending_model = NULL,
              pending_sources = NULL, pending_edition = NULL, pending_at = NULL
        WHERE entity_type='shortcut' AND insight='daily:b' AND pending_edition=$1
        RETURNING entity_key`, [key, live.releaseAt.toISOString()]);
    // revamp1433g: stamped with the EDITION's release time, not the moment this
    // cron happened to fire. The card's dateline is this stamp, and an edition
    // that publishes a few minutes late must still say 5:00, not 9:35.
    await sql.query(
      `UPDATE ai_audio SET release_at = least(release_at, now())
        WHERE kind='flagship' AND family_slug='home' AND edition_date=$1 AND edition=$2
          AND (release_at IS NULL OR release_at > now())`, [date, edition]);

    // revamp1435: say how whole the edition actually is. A briefing that failed
    // twice keeps its previous text and nothing crashes, so without this number
    // nobody would ever learn that two topics are an edition behind.
    const behind = await sql.query(
      `SELECT count(*)::int AS n FROM ai_insights
        WHERE entity_type='shortcut' AND insight='daily:b' AND created_at < $1
          AND entity_key = ANY($2)`,
      [live.releaseAt.toISOString(), LIVE_KEYS]);

    return res.status(200).json({
      ok: true, released: true, edition: key,
      briefs: promoted.length, episode: ep[0].id, stale: behind[0].n,
    });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err).slice(0, 300) });
  }
};

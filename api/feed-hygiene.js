// GET/POST /api/feed-hygiene — admin-only view + control of the Phase 6 pipeline
// (semantic dedup + AI junk gate on news_stories).
//
// Auth: Bearer ${CRON_SECRET} (same convention as /api/ai-usage — the admin panel
// stores the secret in localStorage and sends it on every call).
//
// GET  → { summary, byTopic, recent }
//   summary : lifetime + last-7d counts (dupes, junk, ok, ungraded)
//   byTopic : per-topic flag counts over the last 7 days (worst first)
//   recent  : newest ~40 flagged stories (kind: 'dup'|'junk'; dups include the
//             canonical story's title) — the false-positive review queue.
// POST { id, action:'unflag' } → clears dup_of AND sets quality='ok' (auditable
//   reversal: flagged stories are never deleted, so unflag restores them fully).

const { getSql } = require('../lib/db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const sql = getSql();
  if (!sql) return res.status(200).json({ skipped: true });

  try {
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
      const id = parseInt(body && body.id, 10);
      if (!Number.isInteger(id) || (body.action !== 'unflag')) {
        return res.status(400).json({ error: 'Expected { id, action: "unflag" }' });
      }
      const r = await sql.query(
        `UPDATE news_stories SET dup_of = NULL, quality = 'ok' WHERE id = $1 RETURNING id`, [id]);
      return res.status(200).json({ ok: true, unflagged: r.length === 1 });
    }

    const [summary] = await sql.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE dup_of IS NOT NULL)::int AS dupes,
              count(*) FILTER (WHERE quality = 'junk')::int AS junk,
              count(*) FILTER (WHERE quality = 'ok')::int AS ok,
              count(*) FILTER (WHERE quality IS NULL)::int AS ungraded,
              count(*) FILTER (WHERE dup_of IS NOT NULL AND fetched_at > now() - interval '7 days')::int AS dupes_7d,
              count(*) FILTER (WHERE quality = 'junk' AND fetched_at > now() - interval '7 days')::int AS junk_7d,
              count(*) FILTER (WHERE fetched_at > now() - interval '7 days')::int AS new_7d
         FROM news_stories`);

    const byTopic = await sql.query(
      `SELECT t.slug, t.name,
              count(*) FILTER (WHERE s.dup_of IS NOT NULL)::int AS dupes,
              count(*) FILTER (WHERE s.quality = 'junk')::int AS junk,
              count(*)::int AS stories
         FROM news_stories s JOIN topics t ON t.id = s.topic_id
        WHERE s.fetched_at > now() - interval '7 days'
        GROUP BY t.slug, t.name
       HAVING count(*) FILTER (WHERE s.dup_of IS NOT NULL) > 0
           OR count(*) FILTER (WHERE s.quality = 'junk') > 0
        ORDER BY (count(*) FILTER (WHERE s.quality = 'junk')) DESC,
                 (count(*) FILTER (WHERE s.dup_of IS NOT NULL)) DESC
        LIMIT 30`);

    const recent = await sql.query(
      `SELECT s.id, t.slug, s.title, s.source_name, s.url, s.fetched_at,
              CASE WHEN s.quality = 'junk' THEN 'junk' ELSE 'dup' END AS kind,
              c.title AS canonical_title
         FROM news_stories s
         JOIN topics t ON t.id = s.topic_id
         LEFT JOIN news_stories c ON c.id = s.dup_of
        WHERE s.dup_of IS NOT NULL OR s.quality = 'junk'
        ORDER BY s.fetched_at DESC
        LIMIT 40`);

    return res.status(200).json({ summary, byTopic, recent });
  } catch (err) {
    // Pre-migration (no dup_of/quality columns) → explain instead of a bare 500.
    const msg = String((err && err.message) || err);
    if (/column .* does not exist/i.test(msg)) {
      return res.status(200).json({ pending: true, note: 'Run db/migrations/2026-07-29-dedup-junk.sql to activate.' });
    }
    return res.status(500).json({ error: msg.slice(0, 200) });
  }
};

// Vercel Cron — /api/cron/embed  (schedule in vercel.json)
//
// Backfills + maintains semantic-search embeddings. Each call embeds ONE small
// batch of rows still missing an embedding (newest first, news before trends),
// then returns counts — pacing it well under Gemini's free-tier rate limits.
// The scheduled run nibbles steadily; manual calls (?n=) can probe/accelerate.
// Graceful: a rate-limit (429) returns {error} without throwing, so the next
// run just picks up where it left off.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`.
//   200 — { ok, table, embedded, remaining, error? , done? }

const { getSql } = require('../../lib/db');
const { embed, toVector } = require('../../lib/gemini');

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const sql = getSql();
  if (!sql || !process.env.GEMINI_API_KEY) return res.status(200).json({ ok: true, skipped: true });

  const n = Math.min(Math.max(parseInt(req.query.n, 10) || 64, 1), 100);

  try {
    // Only news_stories embeddings are queried (semantic search in api/news-search).
    // trending_items.embedding was written but NEVER read — no longer embedded, and
    // the column is dropped in the storage-trim migration (#storage-trim 2026-07-22).
    const remRows = await sql`SELECT count(*) AS news FROM news_stories WHERE embedding IS NULL`;
    const remaining = { news: Number(remRows[0].news) };

    const table = 'news_stories';
    const rows = await sql.query(
      `SELECT id, coalesce(title,'') || ' ' || coalesce(description,'') AS text
         FROM news_stories WHERE embedding IS NULL ORDER BY id DESC LIMIT ${n}`
    );
    if (!rows.length) return res.status(200).json({ ok: true, embedded: 0, remaining, done: true });

    let embedded = 0;
    let error = null;
    try {
      const vecs = await embed(rows.map(r => r.text));
      if (vecs) {
        const tuples = [];
        const params = [];
        let p = 1;
        for (let i = 0; i < rows.length; i++) {
          const v = vecs[i];
          if (!v || !v.length) continue;
          tuples.push(`($${p++}::int, $${p++}::vector)`);
          params.push(rows[i].id, toVector(v));
        }
        if (tuples.length) {
          await sql.query(
            `UPDATE ${table} AS t SET embedding = v.emb
               FROM (VALUES ${tuples.join(',')}) AS v(id, emb) WHERE t.id = v.id`,
            params
          );
          embedded = tuples.length;
        }
      }
    } catch (e) {
      error = String((e && e.message) || e).slice(0, 200);
    }

    return res.status(200).json({ ok: !error, table, embedded, error, remaining });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};

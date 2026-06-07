// Vercel Cron — /api/cron/embed  (schedule in vercel.json)
//
// Backfills + maintains semantic-search embeddings. Each run grabs a batch of
// rows still missing an embedding (newest first), embeds them with Gemini
// (batched 100/call), and writes the vectors back. Running every couple hours
// it both fills history and keeps up with new ingested rows. Embeddings are
// cheap + free-tier; no spend cap needed here.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`.
//   200 — { ok, news, trends }   (counts embedded; skipped:true pre-provision)

const { getSql } = require('../../lib/db');
const { embed, toVector } = require('../../lib/gemini');

const NEWS_BATCH = 300;   // rows scanned per run
const TREND_BATCH = 200;
const CHUNK = 100;        // Gemini batchEmbedContents ceiling

async function embedTable(sql, table, selectSql) {
  const rows = await sql.query(selectSql);
  if (!rows.length) return 0;
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const vecs = await embed(chunk.map(r => r.text));
    if (!vecs) break;
    const tuples = [];
    const params = [];
    let p = 1;
    for (let j = 0; j < chunk.length; j++) {
      const v = vecs[j];
      if (!v || !v.length) continue;
      tuples.push(`($${p++}::int, $${p++}::vector)`);
      params.push(chunk[j].id, toVector(v));
    }
    if (!tuples.length) continue;
    await sql.query(
      `UPDATE ${table} AS t SET embedding = v.emb
         FROM (VALUES ${tuples.join(',')}) AS v(id, emb)
        WHERE t.id = v.id`,
      params
    );
    done += tuples.length;
  }
  return done;
}

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const sql = getSql();
  if (!sql || !process.env.GEMINI_API_KEY) return res.status(200).json({ ok: true, skipped: true });

  try {
    const news = await embedTable(
      sql, 'news_stories',
      `SELECT id, coalesce(title,'') || ' ' || coalesce(description,'') AS text
         FROM news_stories WHERE embedding IS NULL ORDER BY id DESC LIMIT ${NEWS_BATCH}`
    );
    const trends = await embedTable(
      sql, 'trending_items',
      `SELECT id, coalesce(query,'') || ' ' || coalesce(category,'') AS text
         FROM trending_items WHERE embedding IS NULL ORDER BY id DESC LIMIT ${TREND_BATCH}`
    );
    return res.status(200).json({ ok: true, news, trends });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};

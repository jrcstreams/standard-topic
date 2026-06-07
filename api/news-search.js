// Vercel serverless function — GET /api/news-search
//
// Global search/browse across the STORED news archive (all topics), powering
// the History pop-up's News tab. Companion to /api/news/{slug} (single topic).
//
// Query params:
//   q       string            — full-text search over title+description (optional)
//   limit   1..100 (def 30)   — page size
//   before  ISO timestamp     — keyset cursor: only stories older than this
//
//   200 — { count, q, stories: [{ ...story, topic_slug, topic_name }], nextBefore }
//   503 — { error }           (database not configured yet)

const { getSql } = require('../lib/db');

const CACHE_HEADER = 'public, s-maxage=120, stale-while-revalidate=3600';

module.exports = async function handler(req, res) {
  const sql = getSql();
  if (!sql) return res.status(503).json({ error: 'Database not configured' });

  const q = (req.query.q || '').trim();
  const before = (req.query.before || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);

  try {
    const where = [];
    const params = [];
    if (q) {
      params.push(q);
      where.push(`n.search_vector @@ websearch_to_tsquery('english', $${params.length})`);
    }
    if (before) {
      params.push(before);
      where.push(`n.published_at < $${params.length}`);
    }
    params.push(limit);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const stories = await sql.query(
      `SELECT n.id, n.url, n.title, n.description, n.source_name, n.source_url,
              n.image_url, n.published_at, n.fetched_at,
              t.slug AS topic_slug, t.name AS topic_name
         FROM news_stories n
         JOIN topics t ON t.id = n.topic_id
         ${whereSql}
        ORDER BY n.published_at DESC NULLS LAST, n.id DESC
        LIMIT $${params.length}`,
      params
    );

    const last = stories[stories.length - 1];
    const nextBefore = stories.length === limit && last && last.published_at ? last.published_at : null;

    res.setHeader('Cache-Control', CACHE_HEADER);
    return res.status(200).json({ count: stories.length, q: q || null, stories, nextBefore });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};

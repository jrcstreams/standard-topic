// Vercel serverless function — GET /api/news/{topicSlug}
//
// Serves the STORED news history for a topic (from news_stories), as opposed
// to /api/feeds/{slug} which proxies the live rss.app feed. This is what
// powers longer history + search.
//
// Query params:
//   limit   1..100   (default 30)   — page size
//   before  ISO/id                  — cursor: only stories older than this
//                                     published_at (keyset pagination)
//   q       string                  — full-text search over title+description
//
//   200 — { topic, count, q, stories, nextBefore }
//   400 — { error }                 (missing slug)
//   404 — { error }                 (unknown topic)
//   503 — { error }                 (database not configured yet)

const { getSql } = require('../../lib/db');

const CACHE_HEADER = 'public, s-maxage=300, stale-while-revalidate=3600';

module.exports = async function handler(req, res) {
  const sql = getSql();
  if (!sql) return res.status(503).json({ error: 'Database not configured' });

  const slug = (req.query && req.query.topic || '').trim();
  if (!slug) return res.status(400).json({ error: 'Missing topic' });

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
  const q = (req.query.q || '').trim();
  const before = (req.query.before || '').trim();

  try {
    const topicRows = await sql.query('SELECT id, slug, name FROM topics WHERE slug = $1', [slug]);
    const topic = topicRows[0];
    if (!topic) return res.status(404).json({ error: 'Topic not found' });

    const where = ['topic_id = $1'];
    const params = [topic.id];
    if (q) {
      params.push(q);
      where.push(`search_vector @@ websearch_to_tsquery('english', $${params.length})`);
    }
    if (before) {
      params.push(before);
      where.push(`published_at < $${params.length}`);
    }
    params.push(limit);

    const stories = await sql.query(
      `SELECT id, url, title, description, source_name, source_url, image_url, published_at, fetched_at
         FROM news_stories
        WHERE ${where.join(' AND ')}
        ORDER BY published_at DESC NULLS LAST, id DESC
        LIMIT $${params.length}`,
      params
    );

    const last = stories[stories.length - 1];
    const nextBefore = stories.length === limit && last && last.published_at ? last.published_at : null;

    res.setHeader('Cache-Control', CACHE_HEADER);
    return res.status(200).json({ topic: topic.slug, count: stories.length, q: q || null, stories, nextBefore });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};

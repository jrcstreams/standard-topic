// Vercel serverless function — GET /api/news-search
//
// Global search/browse across the STORED news archive (all topics), powering
// the History/Search-modal News results.
//
// With a query (q), this is HYBRID + SEMANTIC: it runs a keyword full-text
// search AND a vector nearest-neighbor search (Gemini embeddings via pgvector),
// then merges them with reciprocal-rank fusion. So "horse" surfaces Kentucky
// Derby coverage even when the word never appears. Falls back to keyword-only
// if embeddings aren't available yet.
//
// Without a query, returns the most recent stories (keyset-paginated).
//
// Params: q, limit (1..100, def 30), before (ISO cursor; recent mode only)
//   200 — { count, q, stories: [{ ...story, topic_slug, topic_name }], nextBefore, semantic }
//   503 — { error }   (database not configured yet)

const { getSql } = require('../lib/db');
const { embedQuery, toVector } = require('../lib/gemini');
const { publicBudgetLeft, bumpSurface } = require('../lib/insight-core');

// This endpoint is UNAUTHENTICATED and embeds every distinct query, so it is a
// paid call any stranger can trigger. Two brakes (revamp966):
//
//  1. A per-instance LRU. Query embeddings are deterministic for a given
//     string and never change, so re-embedding "ukraine" is pure waste. Also
//     removes ~500ms from a repeat search (measured: 698ms with the embed vs
//     ~160ms without).
//  2. A daily cap on NEW embeddings, counted on its own ai_usage_surface row so
//     an abused search box cannot drain the shared AI budget out from under the
//     briefs. Past the cap the query degrades to keyword-only — which still
//     returns good results, just without semantic recall.
const EMBED_CACHE = new Map();
const EMBED_CACHE_MAX = 500;
const EMBED_DAILY_CAP = parseInt(process.env.AI_SEARCH_EMBED_CAP || '400', 10);

function cacheGet(k) {
  if (!EMBED_CACHE.has(k)) return undefined;
  const v = EMBED_CACHE.get(k);
  EMBED_CACHE.delete(k); EMBED_CACHE.set(k, v);   // refresh recency
  return v;
}
function cacheSet(k, v) {
  EMBED_CACHE.set(k, v);
  if (EMBED_CACHE.size > EMBED_CACHE_MAX) EMBED_CACHE.delete(EMBED_CACHE.keys().next().value);
}

const CACHE_HEADER = 'public, s-maxage=120, stale-while-revalidate=3600';
const COLS = `n.id, n.url, n.title, n.description, n.source_name, n.source_url,
              n.image_url, n.published_at, n.fetched_at,
              t.slug AS topic_slug, t.name AS topic_name`;

module.exports = async function handler(req, res) {
  const sql = getSql();
  if (!sql) return res.status(503).json({ error: 'Database not configured' });

  const q = (req.query.q || '').trim();
  const before = (req.query.before || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);

  try {
    // ---- Recent / browse (no query) — keyset paginated -------------------
    if (!q) {
      const params = [];
      let whereSql = '';
      if (before) { params.push(before); whereSql = `WHERE n.published_at < $1`; }
      params.push(limit);
      const stories = await sql.query(
        `SELECT ${COLS} FROM news_stories n JOIN topics t ON t.id = n.topic_id
         ${whereSql} ORDER BY n.published_at DESC NULLS LAST, n.id DESC LIMIT $${params.length}`,
        params
      );
      const last = stories[stories.length - 1];
      const nextBefore = stories.length === limit && last && last.published_at ? last.published_at : null;
      res.setHeader('Cache-Control', CACHE_HEADER);
      return res.status(200).json({ count: stories.length, q: null, stories, nextBefore, semantic: false });
    }

    // ---- Search (query) — hybrid keyword + vector -----------------------
    const pool = Math.max(limit * 3, 30);

    const keyword = await sql.query(
      `SELECT ${COLS} FROM news_stories n JOIN topics t ON t.id = n.topic_id
        WHERE n.search_vector @@ websearch_to_tsquery('english', $1)
        ORDER BY n.published_at DESC NULLS LAST LIMIT $2`,
      [q, pool]
    );

    let vector = [];
    let qvec = null;
    const ck = q.toLowerCase();
    const cached = cacheGet(ck);
    if (cached !== undefined) {
      qvec = cached;
    } else if (await publicBudgetLeft(sql, 'embed:search', EMBED_DAILY_CAP)) {
      try { qvec = await embedQuery(q); } catch (_) { qvec = null; }
      if (qvec) { cacheSet(ck, qvec); await bumpSurface(sql, 'embed:search'); }
    }
    // qvec stays null past the cap or on failure → keyword-only below.
    // Semantic results need a real anchor. cap = how far a hit may be to show
    // at all; gate = the best hit must be at least this close, else the query
    // has no genuine coverage (e.g. "drake"/"ohtani") and we drop ALL vector
    // hits to avoid garbage. Literal queries still ride the keyword list.
    const cap = Number(process.env.AI_SEMANTIC_CAP || 0.50);
    const gate = Number(process.env.AI_SEMANTIC_GATE || 0.47);
    let best = null;
    if (qvec) {
      try {
        vector = await sql.query(
          `SELECT ${COLS}, (n.embedding <=> $1::vector) AS _dist
             FROM news_stories n JOIN topics t ON t.id = n.topic_id
            WHERE n.embedding IS NOT NULL AND (n.embedding <=> $1::vector) < $3
            ORDER BY n.embedding <=> $1::vector LIMIT $2`,
          [toVector(qvec), pool, cap]
        );
      } catch (_) {
        vector = []; // embedding column not migrated yet (or pgvector off)
      }
      if (vector.length) {
        best = Math.min(...vector.map(v => Number(v._dist)));
        if (best >= gate) vector = [];
      }
    }

    // Reciprocal-rank fusion across the two ranked lists.
    const score = new Map();
    const byId = new Map();
    const add = (rows) => rows.forEach((r, i) => {
      byId.set(r.id, r);
      score.set(r.id, (score.get(r.id) || 0) + 1 / (60 + i));
    });
    add(keyword);
    add(vector);

    const stories = [...byId.values()]
      .sort((a, b) => (score.get(b.id) - score.get(a.id)))
      .slice(0, limit);

    res.setHeader('Cache-Control', CACHE_HEADER);
    const body = { count: stories.length, q, stories, nextBefore: null, semantic: !!qvec };
    if (req.query.debug) {
      body._debug = { keyword: keyword.length, vector: vector.length, gate, cap, best };
    }
    return res.status(200).json(body);
  } catch (err) {
    console.error('[news-search]', (err && err.message) || err);
    return res.status(500).json({ error: 'Search unavailable' });
  }
};

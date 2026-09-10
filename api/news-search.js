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

// Same story, two topic rows: match on the URL with the tracking noise and
// trailing slash taken off, and fall back to title+source for the feeds that
// hand out a different URL per section.
function dedupeKey(r) {
  const u = (r.url || '').trim().toLowerCase();
  if (u) {
    try {
      const parsed = new URL(u);
      return parsed.host.replace(/^www\./, '') + parsed.pathname.replace(/\/+$/, '');
    } catch (_) { return u.split('?')[0].replace(/\/+$/, ''); }
  }
  return (r.title || '').trim().toLowerCase() + '|' + (r.source_name || '').trim().toLowerCase();
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

    // revamp1285: ranked by RELEVANCE, then recency. Ordering the keyword hits
    // by date alone meant a passing mention in today's story outranked the
    // story the search was about.
    // Two stages, because search_vector is title and description concatenated
    // at equal weight — so "horse" in a motor-oil story's body scored like
    // "horse" in a headline about horses. Stage one takes the best few hundred
    // on the indexed vector (cheap); stage two re-ranks just those with the
    // title counted three times, which is the signal a reader means.
    const keyword = await sql.query(
      `WITH tq AS (SELECT websearch_to_tsquery('english', $1) AS q),
            hits AS (
              SELECT n.id, ts_rank_cd(n.search_vector, (SELECT q FROM tq)) AS r0
                FROM news_stories n
               WHERE n.search_vector @@ (SELECT q FROM tq)
               ORDER BY r0 DESC, n.published_at DESC NULLS LAST
               LIMIT 300
            )
       SELECT ${COLS},
              ts_rank_cd(to_tsvector('english', coalesce(n.title, '')), (SELECT q FROM tq)) * 3
                + h.r0 AS _rank
         FROM hits h
         JOIN news_stories n ON n.id = h.id
         JOIN topics t ON t.id = n.topic_id
        ORDER BY _rank DESC, n.published_at DESC NULLS LAST
        LIMIT $2`,
      [q, pool]
    );

    // No literal hit at all? Before giving up, try it as a MISSPELLING. Full
    // text search has no fuzziness, so "millenium problem" matched nothing
    // while "millennium problem" matched five stories. Trigram word-similarity
    // finds the near-miss inside the title. Needs pg_trgm (db/schema.sql); if
    // the extension isn't there this throws and we carry on without it.
    let fuzzy = [];
    if (!keyword.length && q.length >= 5) {
      try {
        fuzzy = await sql.query(
          `SELECT ${COLS}, word_similarity($1, n.title) AS _sim
             FROM news_stories n JOIN topics t ON t.id = n.topic_id
            WHERE $1 <% n.title
            ORDER BY _sim DESC, n.published_at DESC NULLS LAST LIMIT $2`,
          [q, pool]
        );
      } catch (_) { fuzzy = []; }
    }

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
    // revamp1285: measured on production, the distances do NOT separate a real
    // query from nonsense — "dog adoption" scores 0.383, "rocket launch" 0.380
    // and the mashed keys "asdkjhasd qweqw" score 0.371. So one gate can never
    // do this job alone: the vector list is a SUPPLEMENT to a lexical hit, and
    // with no lexical hit at all it has to clear a bar well under that band or
    // the answer is honestly nothing.
    const soloGate = Number(process.env.AI_SEMANTIC_GATE_SOLO || 0.30);
    const keep = Number(process.env.AI_SEMANTIC_KEEP || 0.35);
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
        const anchored = keyword.length > 0 || fuzzy.length > 0;
        if (best >= (anchored ? gate : soloGate)) vector = [];
        // And a neighbour only counts if it is actually near. Without this the
        // list ran to its limit whatever the query, so "dog adoption" filled
        // its last places with a quarry search and a road collision — rows at
        // 0.38, i.e. no closer than nonsense gets.
        else vector = vector.filter((v) => Number(v._dist) < keep);
      }
    }

    // Weighted reciprocal-rank fusion. Unweighted, a vector hit at rank 0
    // (1/60) beat a keyword hit at rank 2 (1/62), which is how a search for
    // "horse" led with an Etobicoke shooting: the semantic list outranked the
    // stories that literally say horse. A literal match is evidence; a nearby
    // embedding is a suggestion, and is weighted as one.
    const W_KEYWORD = 1;
    const W_FUZZY = 0.9;
    const W_VECTOR = 0.5;
    const score = new Map();
    const byId = new Map();
    const add = (rows, w) => rows.forEach((r, i) => {
      byId.set(r.id, r);
      score.set(r.id, (score.get(r.id) || 0) + w / (60 + i));
    });
    add(keyword, W_KEYWORD);
    add(fuzzy, W_FUZZY);
    add(vector, W_VECTOR);

    // One story, one row. A story that belongs to two topics is two rows in
    // news_stories by design (the archive is keyed per topic), so an archive-
    // wide search showed the same NYT piece twice — once under Artificial
    // Intelligence, once under Science. Keep whichever ranked higher.
    const seen = new Map();
    for (const r of [...byId.values()].sort((a, b) => score.get(b.id) - score.get(a.id))) {
      const key = dedupeKey(r);
      if (!seen.has(key)) seen.set(key, r);
    }
    const stories = [...seen.values()].slice(0, limit);

    res.setHeader('Cache-Control', CACHE_HEADER);
    const body = { count: stories.length, q, stories, nextBefore: null, semantic: !!qvec };
    if (req.query.debug) {
      body._debug = {
        keyword: keyword.length, fuzzy: fuzzy.length, vector: vector.length,
        anchored: keyword.length > 0 || fuzzy.length > 0,
        gate, soloGate, keep, cap, best, deduped: byId.size - seen.size,
      };
    }
    return res.status(200).json(body);
  } catch (err) {
    console.error('[news-search]', (err && err.message) || err);
    return res.status(500).json({ error: 'Search unavailable' });
  }
};

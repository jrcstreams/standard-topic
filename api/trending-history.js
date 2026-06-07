// Vercel serverless function — GET /api/trending-history
//
// Serves STORED trending history from trending_items. Three modes let the
// client sort/slice by date, category, and duration:
//
//   mode=latest (default)
//     Newest snapshot for a geo, ranked. ?limit (1..200, default 50)
//     -> { geo, snapshotAt, items: [{ rank, query, category, search_volume, ... }] }
//
//   mode=range&from=ISO&to=ISO[&category=Sports][&sort=...]
//     Distinct terms seen in the window, aggregated so you can sort by:
//       recent (default) | volume | duration | frequency
//     duration = last time seen active minus first start (=> "trending for so long")
//     -> { geo, from, to, sort, items: [{ query, category, first_seen, last_seen,
//            peak_volume, started_at, last_active, duration_seconds, snapshots }] }
//
//   mode=query&query=TERM
//     One term's timeline across snapshots. ?limit (default 100)
//     -> { geo, query, points: [{ snapshot_at, rank, search_volume, ... }] }
//
//   503 — { error }   (database not configured yet)

const { getSql } = require('../lib/db');

const CACHE_HEADER = 'public, s-maxage=300, stale-while-revalidate=86400';

// Whitelist of range sort options -> SQL (never interpolate user input).
const RANGE_SORTS = {
  recent: 'last_seen DESC',
  volume: 'peak_volume DESC NULLS LAST',
  duration: 'duration_seconds DESC NULLS LAST',
  frequency: 'snapshots DESC',
};

function send(res, body) {
  res.setHeader('Cache-Control', CACHE_HEADER);
  return res.status(200).json(body);
}

module.exports = async function handler(req, res) {
  const sql = getSql();
  if (!sql) return res.status(503).json({ error: 'Database not configured' });

  const geo = (req.query.geo || 'US').trim();
  const mode = (req.query.mode || 'latest').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

  try {
    if (mode === 'query') {
      const query = (req.query.query || '').trim();
      if (!query) return res.status(400).json({ error: 'Missing query' });
      const points = await sql.query(
        `SELECT snapshot_at, rank, category, search_volume, increase_percent,
                started_at, ended_at, active
           FROM trending_items
          WHERE geo = $1 AND lower(query) = lower($2)
          ORDER BY snapshot_at DESC
          LIMIT $3`,
        [geo, query, Math.min(limit, 500)]
      );
      return send(res, { geo, query, points });
    }

    if (mode === 'search') {
      // Keyword match of trending terms — feeds the Search modal's
      // "Trending" results. Distinct terms, most-recently-seen first.
      const term = (req.query.q || '').trim();
      if (!term) return send(res, { geo, q: '', items: [] });
      const items = await sql.query(
        `SELECT query,
                max(category) AS category,
                max(snapshot_at) AS last_seen,
                max(search_volume) AS peak_volume,
                min(coalesce(started_at, snapshot_at)) AS started_at
           FROM trending_items
          WHERE geo = $1 AND query ILIKE '%' || $2 || '%'
          GROUP BY query
          ORDER BY last_seen DESC
          LIMIT $3`,
        [geo, term, limit]
      );
      return send(res, { geo, q: term, items });
    }

    if (mode === 'range') {
      const from = (req.query.from || '').trim();
      const to = (req.query.to || '').trim();
      if (!from || !to) return res.status(400).json({ error: 'mode=range needs from and to (ISO timestamps)' });
      const sort = RANGE_SORTS[(req.query.sort || 'recent').trim()] || RANGE_SORTS.recent;
      const category = (req.query.category || '').trim();

      const params = [geo, from, to];
      let catClause = '';
      if (category) { params.push(category); catClause = `AND category = $${params.length}`; }
      params.push(limit);

      const items = await sql.query(
        `SELECT query,
                max(category) AS category,
                min(snapshot_at) AS first_seen,
                max(snapshot_at) AS last_seen,
                max(search_volume) AS peak_volume,
                min(started_at) AS started_at,
                max(coalesce(ended_at, snapshot_at)) AS last_active,
                extract(epoch FROM (max(coalesce(ended_at, snapshot_at)) - min(coalesce(started_at, snapshot_at))))::bigint AS duration_seconds,
                count(*) AS snapshots
           FROM trending_items
          WHERE geo = $1 AND snapshot_at >= $2 AND snapshot_at <= $3 ${catClause}
          GROUP BY query
          ORDER BY ${sort}
          LIMIT $${params.length}`,
        params
      );
      return send(res, { geo, from, to, sort: (req.query.sort || 'recent'), category: category || null, items });
    }

    // mode=latest (default)
    const latest = await sql.query(
      `SELECT snapshot_at FROM trending_items WHERE geo = $1 ORDER BY snapshot_at DESC LIMIT 1`,
      [geo]
    );
    if (!latest.length) return send(res, { geo, snapshotAt: null, items: [] });
    const snapshotAt = latest[0].snapshot_at;
    const items = await sql.query(
      `SELECT rank, query, category, categories, search_volume, increase_percent,
              started_at, ended_at, active
         FROM trending_items
        WHERE geo = $1 AND snapshot_at = $2
        ORDER BY rank
        LIMIT $3`,
      [geo, snapshotAt, limit]
    );
    return send(res, { geo, snapshotAt, items });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};
